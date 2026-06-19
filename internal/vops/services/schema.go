package services

import (
	"encoding/json"
	"net/http"
)

// FieldDef describes a single configuration field for a service type.
type FieldDef struct {
	Key         string   `json:"key"`
	Label       string   `json:"label"`
	Type        string   `json:"type"` // "text" | "select" | "bool"
	Required    bool     `json:"required,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
	Options     []string `json:"options,omitempty"` // for "select" type
	Hint        string   `json:"hint,omitempty"`
}

// typeFields maps each service_type to its ordered field definitions.
// These fields are stored in the services.config JSON blob.
var typeFields = map[string][]FieldDef{
	"validator": {
		{Key: "rpc_url", Label: "Node RPC URL", Type: "text", Required: true,
			Placeholder: "http://localhost:26657",
			Hint:        "Local node's CometBFT RPC endpoint"},
		{Key: "moniker", Label: "Moniker", Type: "text", Required: true,
			Placeholder: "my-validator"},
		{Key: "valoper", Label: "Valoper Address", Type: "text", Required: true,
			Placeholder: "chihuahuavaloper1…"},
		{Key: "wallet_key_name", Label: "Wallet Key Name", Type: "text",
			Placeholder: "validator-key"},
		{Key: "preferred_explorer", Label: "Explorer URL", Type: "text",
			Placeholder: "https://ping.pub/chihuahua"},
		{Key: "ref_rpc_url", Label: "Reference RPC (synced node)", Type: "text",
			Placeholder: "https://rpc.chihuahua.wtf",
			Hint:        "Synced public/peer RPC used for ETA calculation"},
	},
	"api": {
		{Key: "rpc_url", Label: "API URL", Type: "text", Required: true,
			Placeholder: "http://localhost:1317"},
		{Key: "moniker", Label: "Moniker", Type: "text", Required: true},
		{Key: "preferred_explorer", Label: "Explorer URL", Type: "text",
			Placeholder: "https://ping.pub/chihuahua"},
		{Key: "ref_rpc_url", Label: "Reference RPC (synced node)", Type: "text",
			Hint: "Used for ETA calculation"},
	},
	"rpc": {
		{Key: "rpc_url", Label: "RPC URL", Type: "text", Required: true,
			Placeholder: "http://localhost:26657"},
		{Key: "moniker", Label: "Moniker", Type: "text", Required: true},
		{Key: "preferred_explorer", Label: "Explorer URL", Type: "text",
			Placeholder: "https://ping.pub/chihuahua"},
		{Key: "ref_rpc_url", Label: "Reference RPC (synced node)", Type: "text",
			Hint: "Used for ETA calculation"},
	},
	"node": {
		{Key: "rpc_url", Label: "Node RPC URL", Type: "text", Required: true,
			Placeholder: "http://localhost:26657"},
		{Key: "moniker", Label: "Moniker", Type: "text", Required: true},
		{Key: "preferred_explorer", Label: "Explorer URL", Type: "text",
			Placeholder: "https://ping.pub/chihuahua"},
		{Key: "ref_rpc_url", Label: "Reference RPC (synced node)", Type: "text",
			Hint: "Used for ETA calculation"},
	},
	"relayer": {
		{Key: "rpc_url", Label: "Relayer RPC URL", Type: "text", Required: true,
			Placeholder: "http://localhost:26657"},
		{Key: "moniker", Label: "Moniker", Type: "text", Required: true},
		{Key: "wallet_key_name", Label: "Wallet Key Name", Type: "text",
			Placeholder: "relayer-key"},
		{Key: "channels", Label: "IBC Channels", Type: "text",
			Placeholder: "channel-0,channel-1",
			Hint:        "Comma-separated channel IDs being relayed"},
		{Key: "preferred_explorer", Label: "Explorer URL", Type: "text",
			Placeholder: "https://ping.pub/chihuahua"},
		{Key: "ref_rpc_url", Label: "Reference RPC (synced node)", Type: "text",
			Hint: "Used for ETA calculation"},
	},
	"webserver": {
		{Key: "engine", Label: "Web Server Engine", Type: "select", Required: true,
			Options: []string{"nginx", "apache2", "caddy", "other"}},
		{Key: "public_ip", Label: "Public IP / Domain", Type: "text", Required: true,
			Placeholder: "1.2.3.4 or example.com"},
		{Key: "cert_domain", Label: "TLS Certificate Domain", Type: "text",
			Placeholder: "example.com",
			Hint:        "Domain to check cert expiry for"},
	},
	"vprox": {
		{Key: "api_url", Label: "vProx API URL", Type: "text",
			Placeholder: "http://localhost:8080"},
	},
	"other": {
		{Key: "note", Label: "Notes", Type: "text",
			Placeholder: "Describe this service"},
	},
}

// HandleSchema returns the field definitions for all or one service type.
//
//	GET /api/v1/services/schema           → all types
//	GET /api/v1/services/schema?type=X    → single type
func (h *Handlers) HandleSchema(w http.ResponseWriter, r *http.Request) {
	t := r.URL.Query().Get("type")
	if t != "" {
		fields, ok := typeFields[t]
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown service_type"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{t: fields})
		return
	}
	writeJSON(w, http.StatusOK, typeFields)
}

// requiredFieldKeys returns required field keys for a service type.
func requiredFieldKeys(svcType string) []string {
	fields := typeFields[svcType]
	var req []string
	for _, f := range fields {
		if f.Required {
			req = append(req, f.Key)
		}
	}
	return req
}

// validateConfig checks that all required config fields are present and non-empty.
// Returns the first missing field key, or "" if all required fields are present.
func validateConfig(svcType string, config json.RawMessage) string {
	required := requiredFieldKeys(svcType)
	if len(required) == 0 {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal(config, &m); err != nil || len(m) == 0 {
		return required[0]
	}
	for _, key := range required {
		v, ok := m[key]
		if !ok {
			return key
		}
		s, _ := v.(string)
		if s == "" {
			return key
		}
	}
	return ""
}
