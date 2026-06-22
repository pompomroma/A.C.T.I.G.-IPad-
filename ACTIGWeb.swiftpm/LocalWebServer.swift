import Foundation
import Network

/// A minimal loopback static-file HTTP/1.1 server used to serve the bundled
/// WebApp/ resources to the in-app WKWebView. Serving over http://127.0.0.1
/// (rather than file://) gives the page a "secure context", which is required for
/// getUserMedia (camera/mic) and WebGPU. Loopback connections do not trigger the
/// iOS local-network privacy prompt.
final class LocalWebServer {
    private let listener: NWListener
    private let rootURL: URL
    private let queue = DispatchQueue(label: "actig.localserver", attributes: .concurrent)

    init(rootURL: URL) throws {
        self.rootURL = rootURL
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        // Port 0 → the system assigns a free port, which we read once ready.
        self.listener = try NWListener(using: params)
    }

    /// Starts listening; `onReady` is called with the assigned port number.
    func start(onReady: @escaping (UInt16) -> Void) {
        listener.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            if case .ready = state, let port = self.listener.port {
                onReady(port.rawValue)
            }
        }
        listener.newConnectionHandler = { [weak self] conn in
            self?.accept(conn)
        }
        listener.start(queue: queue)
    }

    // MARK: - Connection handling

    private func accept(_ conn: NWConnection) {
        conn.start(queue: queue)
        receive(conn, buffer: Data())
    }

    /// Reads until the end of the HTTP request headers (\r\n\r\n), then responds.
    private func receive(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            var buffer = buffer
            if let data { buffer.append(data) }

            if let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) {
                let headerData = buffer.subdata(in: buffer.startIndex..<headerEnd.lowerBound)
                let header = String(decoding: headerData, as: UTF8.self)
                self.respond(conn, requestHeader: header)
            } else if error == nil && !isComplete {
                self.receive(conn, buffer: buffer)   // keep reading headers
            } else {
                conn.cancel()
            }
        }
    }

    private func respond(_ conn: NWConnection, requestHeader: String) {
        let firstLine = requestHeader.split(separator: "\r\n").first.map(String.init) ?? ""
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2 else { send(conn, status: "400 Bad Request", body: Data(), type: "text/plain"); return }

        // Strip query/fragment and decode the path.
        var path = String(parts[1])
        if let q = path.firstIndex(of: "?") { path = String(path[..<q]) }
        if let h = path.firstIndex(of: "#") { path = String(path[..<h]) }
        path = path.removingPercentEncoding ?? path
        if path == "/" || path.isEmpty { path = "/index.html" }

        guard let fileURL = resolve(path) else {
            send(conn, status: "404 Not Found", body: Data("Not found".utf8), type: "text/plain")
            return
        }
        guard let data = try? Data(contentsOf: fileURL) else {
            send(conn, status: "404 Not Found", body: Data("Not found".utf8), type: "text/plain")
            return
        }
        send(conn, status: "200 OK", body: data, type: Self.contentType(for: fileURL.pathExtension))
    }

    /// Maps a URL path to a file inside rootURL, preventing directory traversal.
    private func resolve(_ path: String) -> URL? {
        let clean = path.split(separator: "/").filter { $0 != ".." && $0 != "." }
        var url = rootURL
        for c in clean { url.appendPathComponent(String(c)) }
        let standardized = url.standardizedFileURL
        guard standardized.path.hasPrefix(rootURL.standardizedFileURL.path),
              FileManager.default.fileExists(atPath: standardized.path) else { return nil }
        return standardized
    }

    private func send(_ conn: NWConnection, status: String, body: Data, type: String) {
        var headers = "HTTP/1.1 \(status)\r\n"
        headers += "Content-Type: \(type)\r\n"
        headers += "Content-Length: \(body.count)\r\n"
        headers += "Cache-Control: no-store\r\n"
        headers += "Connection: close\r\n\r\n"
        var out = Data(headers.utf8)
        out.append(body)
        conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
    }

    /// Correct MIME types — ES modules require a JavaScript type or they won't load.
    static func contentType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs":   return "text/javascript; charset=utf-8"
        case "css":         return "text/css; charset=utf-8"
        case "json":        return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json; charset=utf-8"
        case "wasm":        return "application/wasm"
        case "png":         return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg":         return "image/svg+xml"
        case "ico":         return "image/x-icon"
        default:            return "application/octet-stream"
        }
    }
}
