package main

import (
	"testing"
)

func TestParseConfig(t *testing.T) {
	raw := `[Interface]
PrivateKey = oK56DE9Ue9zK76rAc8pBl6opph+1v36lm7cXXsQKrQM=
Address = 10.200.100.8/24
DNS = 10.200.100.1
ListenPort = 51820
MTU = 1420
Table = auto
PreUp = echo pre-up
PostUp = iptables -A FORWARD -i %i -j ACCEPT
PreDown = echo pre-down
PostDown = iptables -D FORWARD -i %i -j ACCEPT
SaveConfig = true

[Peer]
PublicKey = GtL7fZc/bLnqZldpVofMCD6hDjrK28SsdLxevJ+qtKU=
AllowedIPs = 0.0.0.0/0
Endpoint = demo.wireguard.com:51820
PersistentKeepalive = 25
`

	cfg, peers, err := ParseConfig(raw)
	if err != nil {
		t.Fatalf("ParseConfig: %v", err)
	}

	if cfg.Address != "10.200.100.8/24" {
		t.Errorf("address = %q, want 10.200.100.8/24", cfg.Address)
	}
	if cfg.ListenPort != 51820 {
		t.Errorf("listenPort = %d, want 51820", cfg.ListenPort)
	}
	if cfg.DNS != "10.200.100.1" {
		t.Errorf("dns = %q, want 10.200.100.1", cfg.DNS)
	}
	if cfg.MTU != 1420 {
		t.Errorf("mtu = %d, want 1420", cfg.MTU)
	}
	if cfg.Table != "auto" {
		t.Errorf("table = %q, want auto", cfg.Table)
	}
	if cfg.PreUp != "echo pre-up" {
		t.Errorf("preUp = %q", cfg.PreUp)
	}
	if cfg.PostUp != "iptables -A FORWARD -i %i -j ACCEPT" {
		t.Errorf("postUp = %q", cfg.PostUp)
	}
	if cfg.PreDown != "echo pre-down" {
		t.Errorf("preDown = %q", cfg.PreDown)
	}
	if cfg.PostDown != "iptables -D FORWARD -i %i -j ACCEPT" {
		t.Errorf("postDown = %q", cfg.PostDown)
	}
	if !cfg.SaveConfig {
		t.Error("saveConfig should be true")
	}

	if len(peers) != 1 {
		t.Fatalf("peers = %d, want 1", len(peers))
	}
	p := peers[0]
	if p.PublicKey != "GtL7fZc/bLnqZldpVofMCD6hDjrK28SsdLxevJ+qtKU=" {
		t.Errorf("peer pubkey mismatch")
	}
	if p.AllowedIPs != "0.0.0.0/0" {
		t.Errorf("peer allowedIPs = %q", p.AllowedIPs)
	}
	if p.Endpoint != "demo.wireguard.com:51820" {
		t.Errorf("peer endpoint = %q", p.Endpoint)
	}
	if p.PersistentKeepalive != 25 {
		t.Errorf("peer keepalive = %d", p.PersistentKeepalive)
	}
}

func TestGenerateConfig(t *testing.T) {
	s := &State{
		Interface: InterfaceConfig{
			PrivateKey:  "abc123",
			Address:     "10.0.0.1/24",
			ListenPort:  51820,
			DNS:         "1.1.1.1",
			MTU:         1420,
			PostUp:      "iptables -A FORWARD -i wg0 -j ACCEPT",
			SaveConfig:  true,
		},
		Peers: []Peer{
			{
				Name:                 "peer1",
				PublicKey:            "xyz789",
				AllowedIPs:           "10.0.0.2/32",
				PersistentKeepalive:  25,
			},
		},
	}

	conf := s.GenerateConfig()

	checks := []string{
		"PrivateKey = abc123",
		"Address = 10.0.0.1/24",
		"ListenPort = 51820",
		"DNS = 1.1.1.1",
		"MTU = 1420",
		"SaveConfig = true",
		"PublicKey = xyz789",
		"AllowedIPs = 10.0.0.2/32",
		"PersistentKeepalive = 25",
	}

	for _, c := range checks {
		if !contains(conf, c) {
			t.Errorf("config missing %q", c)
		}
	}
}

func contains(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
