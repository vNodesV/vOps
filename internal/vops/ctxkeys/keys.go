// Package ctxkeys defines typed context keys used across vOps handlers.
// Using an unexported struct type prevents key collisions with any
// other package that might use the same plain-string key.
package ctxkeys

// actorKey is the unexported type for the actor context key.
type actorKey struct{}

// Actor is the singleton context key for the authenticated operator.
// Set by requireSession middleware; read by any handler that needs to
// attribute actions for audit logging.
var Actor = actorKey{}
