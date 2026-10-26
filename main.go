package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"
)

//go:embed web
var webFS embed.FS

func main() {
	addr := ":8080"
	if v := os.Getenv("PORT"); v != "" {
		addr = ":" + v
	}

	arena := NewArenaHub()
	go arena.Run()

	sub, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("embed: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", noCache(http.FileServer(http.FS(sub))))
	mux.HandleFunc("/ws/arena", arena.ServeWS)

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		for _, u := range localListenURLs(addr) {
			log.Printf("superhry listening on %s", u)
		}
		if fastMode {
			log.Printf("FAST MODE: phases shortened for testing")
		}
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("listen: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Println("shutting down...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}

// noCache keeps browsers from holding on to stale JS between builds.
func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

func localListenURLs(addr string) []string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		trimmed := strings.TrimSpace(addr)
		if strings.HasPrefix(trimmed, ":") {
			port = strings.TrimPrefix(trimmed, ":")
		} else {
			port = "8080"
		}
		host = ""
	}
	if host != "" && host != "0.0.0.0" && host != "::" {
		return []string{"http://" + net.JoinHostPort(host, port) + "/"}
	}
	urls := map[string]struct{}{
		"http://localhost:" + port + "/": {},
	}
	ifaces, err := net.InterfaceAddrs()
	if err == nil {
		for _, a := range ifaces {
			ipNet, ok := a.(*net.IPNet)
			if !ok || ipNet.IP == nil {
				continue
			}
			ip4 := ipNet.IP.To4()
			if ip4 == nil || ip4.IsLoopback() {
				continue
			}
			urls["http://"+ip4.String()+":"+port+"/"] = struct{}{}
		}
	}
	out := make([]string, 0, len(urls))
	for u := range urls {
		out = append(out, u)
	}
	sort.Strings(out)
	return out
}
