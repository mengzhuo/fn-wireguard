package main

import (
	"embed"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed web/*
var webFiles embed.FS

func main() {
	gatewayPrefix := os.Getenv("GATEWAY_PREFIX")
	socketPath := os.Getenv("SOCKET_PATH")
	port := os.Getenv("PORT")

	dataDir := os.Getenv("TRIM_PKGVAR")
	if dataDir == "" {
		dataDir = "."
	}
	etcDir := os.Getenv("TRIM_PKGETC")
	if etcDir == "" {
		etcDir = "."
	}

	iface := "wg0"
	if v := os.Getenv("WG_INTERFACE"); v != "" {
		iface = v
	}

	statePath := filepath.Join(dataDir, "state.json")
	wgConfigPath := filepath.Join(etcDir, "wg0.conf")

	s, err := LoadState(statePath)
	if err != nil {
		log.Printf("loading state: %v (starting fresh)", err)
		s = &State{
			Interface: InterfaceConfig{},
			Peers:     []Peer{},
		}
	}

	h := &Handler{
		state:     s,
		statePath: statePath,
		confPath:  wgConfigPath,
		iface:     iface,
	}

	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())

	r.GET("/api/status", h.Status)
	r.GET("/api/settings", h.GetSettings)
	r.PUT("/api/settings", h.UpdateSettings)
	r.POST("/api/apply", h.Apply)
	r.POST("/api/stop", h.Stop)
	r.POST("/api/import", h.Import)
	r.GET("/api/config-file", h.ConfigFile)
	r.GET("/api/peers", h.ListPeers)
	r.POST("/api/peers", h.AddPeer)
	r.GET("/api/peers/:id", h.GetPeer)
	r.PUT("/api/peers/:id", h.UpdatePeer)
	r.DELETE("/api/peers/:id", h.DeletePeer)
	r.GET("/api/peer-config/:id", h.PeerConfig)

	sub, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatalf("embedded web: %v", err)
	}
	r.NoRoute(func(c *gin.Context) {
		http.FileServer(spaFS{http.FS(sub)}).ServeHTTP(c.Writer, c.Request)
	})

	var handler http.Handler = r
	if gatewayPrefix != "" {
		handler = wrapGatewayPrefix(gatewayPrefix, r)
	}

	if socketPath != "" {
		os.Remove(socketPath)
		listener, err := net.Listen("unix", socketPath)
		if err != nil {
			log.Fatalf("listen unix %s: %v", socketPath, err)
		}
		os.Chmod(socketPath, 0666)
		log.Printf("WireGuard UI on socket %s (gateway %s, iface=%s)", socketPath, gatewayPrefix, iface)
		log.Fatal(http.Serve(listener, handler))
	}

	if port == "" {
		port = "51821"
	}
	log.Printf("WireGuard UI on :%s (iface=%s)", port, iface)
	log.Fatal(http.ListenAndServe(":"+port, handler))
}

func wrapGatewayPrefix(prefix string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == prefix {
			http.Redirect(w, r, prefix+"/", http.StatusMovedPermanently)
			return
		}
		if strings.HasPrefix(r.URL.Path, prefix) {
			r.URL.Path = strings.TrimPrefix(r.URL.Path, prefix)
			if r.URL.Path == "" {
				r.URL.Path = "/"
			}
		}
		next.ServeHTTP(w, r)
	})
}

type spaFS struct{ http.FileSystem }

func (s spaFS) Open(name string) (http.File, error) {
	f, err := s.FileSystem.Open(name)
	if err != nil {
		return s.FileSystem.Open("index.html")
	}
	return f, nil
}
