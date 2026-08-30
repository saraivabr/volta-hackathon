package main

import "testing"

func setRequiredConfig(t *testing.T) {
	t.Helper()
	t.Setenv("WACALLS_API_TOKEN", "test-token")
	t.Setenv("VOLTA_BASE_URL", "https://volta.example")
	t.Setenv("RELAY_SHARED_SECRET", "relay-secret")
}

func TestLoadServiceConfigAcceptsPublicWebRTCIP(t *testing.T) {
	setRequiredConfig(t)
	t.Setenv("WACALLS_WEBRTC_PUBLIC_IP", "203.0.113.10")

	config, err := loadServiceConfig()
	if err != nil {
		t.Fatalf("loadServiceConfig() error = %v", err)
	}
	if config.webRTCPublicIP != "203.0.113.10" {
		t.Fatalf("webRTCPublicIP = %q", config.webRTCPublicIP)
	}
}

func TestLoadServiceConfigRejectsInvalidPublicWebRTCIP(t *testing.T) {
	setRequiredConfig(t)
	t.Setenv("WACALLS_WEBRTC_PUBLIC_IP", "not-an-ip")

	if _, err := loadServiceConfig(); err == nil {
		t.Fatal("loadServiceConfig() expected invalid public IP error")
	}
}
