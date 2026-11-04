// ABOUTME: The App Group folder the Safari extension and the app's own copy of it share.
// ABOUTME: packageSafariIOS.sh appends this file to both the app's and the extension's Swift sources.

import Foundation

/// Answers the extension's messages about the folder both copies of it read
/// and write, so Safari and the app keep one identity, history and collages.
/// Each message names one file: `stat`, `read` a slice, `write` (or append) a
/// slice to a side file, and `commit` the side file over the real one.
enum SharedContainer {
    static let groupIdentifier = "group.online.wewere.app"

    static func handle(_ message: Any?, side: String) -> [String: Any] {
        guard let body = message as? [String: Any],
              let operation = body["wwoShared"] as? String else {
            return failure("not a shared folder message")
        }
        if operation == "hello" {
            guard folder() != nil else { return failure("no shared folder") }
            return ["ok": true, "side": side]
        }
        guard let name = body["name"] as? String, isFileName(name) else {
            return failure("not a shared file name")
        }
        guard let folder = folder() else { return failure("no shared folder") }
        let file = folder.appendingPathComponent(name)
        let pending = folder.appendingPathComponent(name + ".pending")
        do {
            switch operation {
            case "stat":
                guard let info = try? FileManager.default.attributesOfItem(atPath: file.path) else {
                    return ["ok": true, "exists": false]
                }
                return [
                    "ok": true,
                    "exists": true,
                    "size": (info[.size] as? NSNumber)?.intValue ?? 0,
                    "modified": milliseconds(info[.modificationDate] as? Date),
                ]
            case "read":
                let offset = (body["offset"] as? NSNumber)?.intValue ?? 0
                let length = (body["length"] as? NSNumber)?.intValue ?? 0
                let handle = try FileHandle(forReadingFrom: file)
                defer { try? handle.close() }
                try handle.seek(toOffset: UInt64(max(0, offset)))
                let data = try handle.read(upToCount: max(0, length)) ?? Data()
                let info = try FileManager.default.attributesOfItem(atPath: file.path)
                return [
                    "ok": true,
                    "data": data.base64EncodedString(),
                    "modified": milliseconds(info[.modificationDate] as? Date),
                ]
            case "write":
                guard let encoded = body["data"] as? String,
                      let data = Data(base64Encoded: encoded) else {
                    return failure("write carried no data")
                }
                let append = (body["append"] as? Bool) ?? false
                if append, FileManager.default.fileExists(atPath: pending.path) {
                    let handle = try FileHandle(forWritingTo: pending)
                    defer { try? handle.close() }
                    try handle.seekToEnd()
                    try handle.write(contentsOf: data)
                } else {
                    try data.write(to: pending)
                }
                return ["ok": true]
            case "commit":
                guard FileManager.default.fileExists(atPath: pending.path) else {
                    return failure("nothing written to commit")
                }
                if FileManager.default.fileExists(atPath: file.path) {
                    _ = try FileManager.default.replaceItemAt(file, withItemAt: pending)
                } else {
                    try FileManager.default.moveItem(at: pending, to: file)
                }
                return ["ok": true]
            default:
                return failure("unknown shared folder operation")
            }
        } catch {
            return failure(error.localizedDescription)
        }
    }

    private static func folder() -> URL? {
        guard let root = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: groupIdentifier
        ) else { return nil }
        let folder = root.appendingPathComponent("wwo-sync", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    private static func isFileName(_ name: String) -> Bool {
        name.range(of: "^[a-z0-9-]+(\\.[a-z0-9-]+)*$", options: .regularExpression) != nil
    }

    private static func milliseconds(_ date: Date?) -> Int {
        Int(((date ?? .distantPast).timeIntervalSince1970 * 1000).rounded())
    }

    private static func failure(_ reason: String) -> [String: Any] {
        ["ok": false, "error": reason]
    }
}
