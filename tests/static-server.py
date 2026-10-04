from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        return


ThreadingHTTPServer(("127.0.0.1", 4173), QuietHandler).serve_forever()
