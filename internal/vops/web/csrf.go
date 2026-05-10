package web

// csrf.go — CSRF protection via the double-submit cookie pattern.
//
// On login the server sets a csrf_token cookie (not HttpOnly so the SPA JS can
// read it).  Every state-changing request from the browser must echo the cookie
// value in the X-CSRF-Token request header.  The withCSRF middleware validates
// that they match before the request reaches any handler.
//
// Why double-submit is sufficient here:
//   - SameSite=Strict on the session cookie already blocks cross-site cookie
//     delivery; this adds belt-and-suspenders coverage.
//   - Cross-origin JS cannot read a SameSite=Strict cookie, so it cannot forge
//     the matching X-CSRF-Token header value.

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
)

const (
	csrfCookieName = "csrf_token"
	csrfHeaderName = "X-CSRF-Token"
)

// newCSRFToken returns a cryptographically random 32-byte hex token.
func newCSRFToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// setCSRFCookie writes the csrf_token cookie.  HttpOnly is intentionally false
// so the SPA JS can read the value for the double-submit header.
func setCSRFCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookieName,
		Value:    token,
		Path:     "/",
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		HttpOnly: false,
		MaxAge:   86400, // 24 h — matches session TTL
	})
}

// clearCSRFCookie deletes the csrf_token cookie on logout.
func clearCSRFCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookieName,
		Value:    "",
		Path:     "/",
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		HttpOnly: false,
		MaxAge:   -1,
	})
}

// withCSRF enforces the double-submit CSRF pattern on state-changing methods
// (POST, PUT, DELETE, PATCH).  GET, HEAD, and OPTIONS are always passed through.
//
// The /login endpoint is explicitly exempted: there is no session (and therefore
// no CSRF cookie) at form-submission time.  Login CSRF (forcing another user to
// log in as the attacker) is an accepted residual risk here; SameSite=Strict
// mitigates it on modern browsers.
//
// On safe-method requests where the cookie is absent (e.g. a user whose session
// pre-dates this middleware), a new token is silently issued so that subsequent
// mutations succeed without requiring a re-login.
func withCSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			// Back-compat: seed the cookie for pre-existing sessions.
			if _, err := r.Cookie(csrfCookieName); err != nil {
				if tok, err := newCSRFToken(); err == nil {
					setCSRFCookie(w, tok)
				}
			}
			next.ServeHTTP(w, r)
			return
		}

		// The login POST has no session/cookie yet — exempt it.
		if r.URL.Path == "/login" || strings.HasSuffix(r.URL.Path, "/login") {
			next.ServeHTTP(w, r)
			return
		}

		cookie, err := r.Cookie(csrfCookieName)
		if err != nil || cookie.Value == "" {
			http.Error(w, "forbidden: missing csrf token", http.StatusForbidden)
			return
		}
		if r.Header.Get(csrfHeaderName) != cookie.Value {
			http.Error(w, "forbidden: csrf token mismatch", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
