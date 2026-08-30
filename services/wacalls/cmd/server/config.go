package main

import (
	"crypto/subtle"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
)

type serviceConfig struct {
	apiToken       string
	voltaBaseURL   string
	relaySecret    string
	model          string
	allowedOrigin  string
	allowedPhones  map[string]struct{}
	webRTCPublicIP string
}

func loadServiceConfig() (serviceConfig, error) {
	config := serviceConfig{
		apiToken:       strings.TrimSpace(os.Getenv("WACALLS_API_TOKEN")),
		voltaBaseURL:   strings.TrimRight(strings.TrimSpace(os.Getenv("VOLTA_BASE_URL")), "/"),
		relaySecret:    strings.TrimSpace(os.Getenv("RELAY_SHARED_SECRET")),
		model:          strings.TrimSpace(os.Getenv("OPENAI_REALTIME_MODEL")),
		allowedOrigin:  strings.TrimSpace(os.Getenv("WACALLS_ALLOWED_ORIGIN")),
		allowedPhones:  map[string]struct{}{},
		webRTCPublicIP: strings.TrimSpace(os.Getenv("WACALLS_WEBRTC_PUBLIC_IP")),
	}
	if config.apiToken == "" {
		return serviceConfig{}, fmt.Errorf("WACALLS_API_TOKEN is required")
	}
	if config.voltaBaseURL == "" || config.relaySecret == "" {
		return serviceConfig{}, fmt.Errorf("VOLTA_BASE_URL and RELAY_SHARED_SECRET are required")
	}
	parsed, err := url.Parse(config.voltaBaseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return serviceConfig{}, fmt.Errorf("VOLTA_BASE_URL must be an HTTPS origin")
	}
	if config.model == "" {
		config.model = "gpt-realtime-2.1"
	}
	if config.webRTCPublicIP != "" && net.ParseIP(config.webRTCPublicIP) == nil {
		return serviceConfig{}, fmt.Errorf("WACALLS_WEBRTC_PUBLIC_IP must be a valid IP address")
	}
	for _, raw := range strings.Split(os.Getenv("WACALLS_ALLOWED_PHONES"), ",") {
		if phone := normalizePhone(raw); phone != "" {
			config.allowedPhones[phone] = struct{}{}
		}
	}
	return config, nil
}

func (c serviceConfig) authorize(header string) bool {
	expected := "Bearer " + c.apiToken
	if len(header) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(header), []byte(expected)) == 1
}

func (c serviceConfig) phoneAllowed(phone string) bool {
	_, ok := c.allowedPhones[normalizePhone(phone)]
	return ok
}
