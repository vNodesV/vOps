package multiprox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// encryptAPIKey encrypts plaintext with AES-256-GCM using key.
// Output format: base64(nonce‖ciphertext‖tag).
// Returns plaintext unchanged when key is the zero value (encryption disabled).
func encryptAPIKey(key [32]byte, plaintext string) (string, error) {
	if key == ([32]byte{}) || plaintext == "" {
		return plaintext, nil
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", fmt.Errorf("multiprox/crypto: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("multiprox/crypto: new gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("multiprox/crypto: gen nonce: %w", err)
	}
	ct := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.StdEncoding.EncodeToString(ct), nil
}

// decryptAPIKey decrypts a value previously produced by encryptAPIKey.
// Returns the ciphertext string unchanged (with no error) when key is the zero
// value — allows safe fallback when encryption is disabled.
// Returns the input unchanged when it does not look like valid ciphertext
// (not valid base64, too short) — handles legacy plaintext rows gracefully.
func decryptAPIKey(key [32]byte, ciphertext string) (string, error) {
	if key == ([32]byte{}) || ciphertext == "" {
		return ciphertext, nil
	}
	raw, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		// Not base64 → treat as legacy plaintext.
		return ciphertext, nil
	}
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", fmt.Errorf("multiprox/crypto: new cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("multiprox/crypto: new gcm: %w", err)
	}
	nonceSize := gcm.NonceSize()
	if len(raw) < nonceSize+gcm.Overhead() {
		// Too short to be valid ciphertext → treat as legacy plaintext.
		return ciphertext, nil
	}
	nonce, ct := raw[:nonceSize], raw[nonceSize:]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		// Decryption failed → treat as legacy plaintext.
		return ciphertext, nil
	}
	return string(plain), nil
}

// LoadOrGenerateKey loads the 32-byte AES key from keyPath.
// If the file does not exist, a new random key is generated and written with
// 0600 permissions. Returns the zero key (encryption disabled) on any error,
// logging the failure to stderr.
func LoadOrGenerateKey(keyPath string) [32]byte {
	var key [32]byte
	raw, err := os.ReadFile(keyPath)
	if err == nil {
		if len(raw) >= 32 {
			copy(key[:], raw[:32])
			return key
		}
	}
	if !os.IsNotExist(err) && err != nil {
		fmt.Fprintf(os.Stderr, "[multiprox] warn: read key %s: %v — api_key encryption disabled\n", keyPath, err)
		return [32]byte{}
	}
	// Generate new key.
	if _, err := io.ReadFull(rand.Reader, key[:]); err != nil {
		fmt.Fprintf(os.Stderr, "[multiprox] warn: generate key: %v — api_key encryption disabled\n", err)
		return [32]byte{}
	}
	if err := os.MkdirAll(filepath.Dir(keyPath), 0700); err != nil {
		fmt.Fprintf(os.Stderr, "[multiprox] warn: create key dir: %v — api_key encryption disabled\n", err)
		return [32]byte{}
	}
	if err := os.WriteFile(keyPath, key[:], 0600); err != nil {
		fmt.Fprintf(os.Stderr, "[multiprox] warn: write key %s: %v — api_key encryption disabled\n", keyPath, err)
		return [32]byte{}
	}
	return key
}
