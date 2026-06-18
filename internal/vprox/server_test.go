package vprox

import (
	"strings"
	"testing"
)

// Regression test for the doubled-host bug: mask_rpc rewrites an upstream
// protocol-relative self-link ("//baseHost:26657/health") into
// "//mask/health" (still protocol-relative). When absolute_links then fires
// on top of that, it must NOT re-prefix the already-protocol-relative value
// with another "https://mask" — that produced "https://mask//mask/health".
func TestRewriteLinks_MaskRPCThenAbsoluteLinks_NoDoubledHost(t *testing.T) {
	s := New(Config{})

	baseHost := "mychain.example.com"
	internalIP := "10.0.0.13"
	mask := "mychain-rpc.example.com"

	// Upstream CometBFT RPC index page emits a protocol-relative self-link.
	upstream := `<a href="//` + baseHost + `:26657/health">/health</a>`

	got := s.rewriteLinks(upstream, rpcPrefix, internalIP, baseHost, mask /* absoluteHost */, mask, true /* rpcVHost */)

	// The mask step already produced a protocol-relative "//mask/health"
	// link; absolute_links must leave it as-is rather than re-prefixing it
	// (which previously produced "https://mask//mask/health").
	want := `<a href="//` + mask + `/health">/health</a>`
	if got != want {
		t.Fatalf("rewriteLinks produced a doubled/incorrect host\n got: %s\nwant: %s", got, want)
	}
	doubled := "https://" + mask + "//" + mask
	if strings.Contains(got, doubled) {
		t.Fatalf("rewriteLinks output still contains the doubled host pattern: %s", got)
	}
}

func TestRewriteAttrToAbsolute(t *testing.T) {
	cases := []struct {
		name           string
		html           string
		requiredPrefix string
		want           string
	}{
		{
			name:           "plain relative path is rewritten",
			html:           `href="/health"`,
			requiredPrefix: "/",
			want:           `href="https://host/health"`,
		},
		{
			name:           "protocol-relative value is left untouched",
			html:           `href="//host/health"`,
			requiredPrefix: "/",
			want:           `href="//host/health"`,
		},
		{
			name:           "already-absolute https value is left untouched",
			html:           `href="https://host/health"`,
			requiredPrefix: "/",
			want:           `href="https://host/health"`,
		},
		{
			name:           "already-absolute http value is left untouched",
			html:           `href="http://host/health"`,
			requiredPrefix: "/",
			want:           `href="http://host/health"`,
		},
		{
			name:           "non-matching prefix is left untouched",
			html:           `href="/other"`,
			requiredPrefix: "/rpc",
			want:           `href="/other"`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := rewriteAttrToAbsolute(c.html, "href", "host", c.requiredPrefix)
			if got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}
