package main

import (
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
)

type Handler struct {
	state     *State
	statePath string
	confPath  string
	iface     string
}

func (h *Handler) Status(c *gin.Context) {
	type response struct {
		Running bool              `json:"running"`
		Status  *WgStatus         `json:"status,omitempty"`
		PeerMap map[string]string `json:"peerMap"`
	}

	resp := response{
		Running: isWgUp(h.iface),
		PeerMap: make(map[string]string),
	}

	if resp.Running {
		s, err := wgShowDump(h.iface)
		if err == nil {
			resp.Status = s
		}
	}

	for _, p := range h.state.Peers {
		resp.PeerMap[p.PublicKey] = p.Name
	}

	c.JSON(http.StatusOK, resp)
}

func (h *Handler) GetSettings(c *gin.Context) {
	c.JSON(http.StatusOK, h.state.Interface)
}

func (h *Handler) UpdateSettings(c *gin.Context) {
	var cfg InterfaceConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	if cfg.PrivateKey == "" {
		cfg.PrivateKey = h.state.Interface.PrivateKey
	}
	h.state.Interface = cfg
	if err := h.state.Save(h.statePath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("save: %v", err)})
		return
	}
	c.JSON(http.StatusOK, h.state.Interface)
}

func (h *Handler) Apply(c *gin.Context) {
	if h.state.Interface.PrivateKey == "" {
		key, err := genPrivateKey()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("gen key: %v", err)})
			return
		}
		h.state.Interface.PrivateKey = key
	}

	if err := h.state.WriteConfig(h.confPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("write config: %v", err)})
		return
	}

	wgQuickDown(h.iface)
	if err := wgQuickUp(h.iface, h.confPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("wg-quick up: %v", err)})
		return
	}

	h.state.Save(h.statePath)
	c.JSON(http.StatusOK, gin.H{"status": "applied"})
}

func (h *Handler) Stop(c *gin.Context) {
	if err := wgQuickDown(h.iface); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "stopped"})
}

func (h *Handler) ListPeers(c *gin.Context) {
	c.JSON(http.StatusOK, h.state.Peers)
}

func (h *Handler) AddPeer(c *gin.Context) {
	var p Peer
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	if p.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}
	if p.AllowedIPs == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "allowedIPs is required"})
		return
	}
	if p.PublicKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "publicKey is required"})
		return
	}

	p.ID = generateID()
	p.CreatedAt = now()
	if p.PersistentKeepalive == 0 {
		p.PersistentKeepalive = 25
	}

	h.state.Peers = append(h.state.Peers, p)
	h.state.Save(h.statePath)
	c.JSON(http.StatusOK, p)
}

func (h *Handler) GetPeer(c *gin.Context) {
	id := c.Param("id")
	for _, p := range h.state.Peers {
		if p.ID == id {
			c.JSON(http.StatusOK, p)
			return
		}
	}
	c.JSON(http.StatusNotFound, gin.H{"error": "peer not found"})
}

func (h *Handler) UpdatePeer(c *gin.Context) {
	id := c.Param("id")
	idx := -1
	for i := range h.state.Peers {
		if h.state.Peers[i].ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "peer not found"})
		return
	}

	var p Peer
	if err := c.ShouldBindJSON(&p); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json"})
		return
	}
	p.ID = id
	p.CreatedAt = h.state.Peers[idx].CreatedAt
	if p.PrivateKey == "" {
		p.PrivateKey = h.state.Peers[idx].PrivateKey
	}
	if p.PublicKey == "" {
		p.PublicKey = h.state.Peers[idx].PublicKey
	}
	h.state.Peers[idx] = p
	h.state.Save(h.statePath)
	c.JSON(http.StatusOK, p)
}

func (h *Handler) DeletePeer(c *gin.Context) {
	id := c.Param("id")
	idx := -1
	for i := range h.state.Peers {
		if h.state.Peers[i].ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "peer not found"})
		return
	}

	h.state.Peers = append(h.state.Peers[:idx], h.state.Peers[idx+1:]...)
	h.state.Save(h.statePath)
	c.JSON(http.StatusOK, gin.H{"status": "deleted"})
}

func (h *Handler) Import(c *gin.Context) {
	var req struct {
		Config string `json:"config"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.Config == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "config field is required"})
		return
	}
	cfg, peers, err := ParseConfig(req.Config)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("parse config: %v", err)})
		return
	}
	h.state.Interface = cfg
	h.state.Peers = peers
	h.state.Save(h.statePath)
	c.JSON(http.StatusOK, gin.H{
		"status":    "imported",
		"interface": cfg,
		"peers":     peers,
	})
}

func (h *Handler) ConfigFile(c *gin.Context) {
	data, err := os.ReadFile(h.confPath)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"config": ""})
		return
	}
	c.JSON(http.StatusOK, gin.H{"config": string(data)})
}

func (h *Handler) PeerConfig(c *gin.Context) {
	id := c.Param("id")
	endpoint := c.Query("endpoint")

	conf, err := h.state.PeerClientConfig(id, endpoint)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	filename := "wg0.conf"
	for _, p := range h.state.Peers {
		if p.ID == id {
			filename = fmt.Sprintf("%s.conf", sanitizeFilename(p.Name))
			break
		}
	}

	c.Header("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	c.Data(http.StatusOK, "text/plain; charset=utf-8", []byte(conf))
}
