import Foundation
import GCDWebServer

@objc
public class LocalBackend: NSObject {
    @objc
    public static let shared = LocalBackend()

    private let server = GCDWebServer()

    override private init() {
        super.init()
        server.addHandler(forMethod: "GET", path: "/healthcheck", request: GCDWebServerRequest.self) { _ in
            return GCDWebServerDataResponse(jsonObject: ["status": "ok"])!
        }

        server.addHandler(forMethod: "POST", path: "/execute-graph", request: GCDWebServerDataRequest.self) { request in
            guard let bodyData = (request as? GCDWebServerDataRequest)?.data else {
                return GCDWebServerResponse(statusCode: 400)
            }
            // Minimal echo implementation: parse JSON and return a dummy response
            if let json = try? JSONSerialization.jsonObject(with: bodyData, options: []) as? [String: Any] {
                let result: [String: Any] = ["ok": true, "input": json, "result": "executed-in-iOS"]
                return GCDWebServerDataResponse(jsonObject: result)!
            }
            return GCDWebServerResponse(statusCode: 500)
        }
    }

    @objc
    public func start() {
        do {
            try server.start(options: [GCDWebServerOption_Port: 7000, GCDWebServerOption_BindToLocalhost: true])
            print("Local backend started at \(server.serverURL?.absoluteString ?? "unknown")")
        } catch {
            print("Local backend failed to start: \(error)")
        }
    }

    @objc
    public func stop() {
        server.stop()
    }
}
