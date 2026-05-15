package main

import (
	"fmt"
	"os"
)

// runConfigCmd is a stub — the interactive config wizard has been removed.
// Edit config files directly under $VPROX_HOME/config/.
func runConfigCmd(_ string, _ []string) {
	fmt.Fprintln(os.Stderr, "vprox config: interactive wizard removed — edit config files directly under $VPROX_HOME/config/")
	os.Exit(1)
}
