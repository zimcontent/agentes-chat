import ActivityKit
import ExpoModulesCore
import Foundation

struct StateInput: Record {
  @Field var title: String = ""
  @Field var line: String = ""
  @Field var progress: Double = 0
  @Field var phase: String = "queued"

  var state: DougActivityAttributes.ContentState {
    DougActivityAttributes.ContentState(title: title, line: line, progress: progress, phase: phase)
  }
}

struct StartInput: Record {
  @Field var agentName: String = ""
  @Field var agentColor: String = "#9CFA05"
  /// The agent's face as a PNG, base64; nil: its initial.
  @Field var face: String? = nil
  @Field var orgId: String = ""
  @Field var runId: String = ""
  @Field var state: StateInput = StateInput()
}

/// Live Activities (docs/adr/doug-0021-lock-screen.md): the app starts one when the person sends work to an agent,
/// hands its push token to the server (`onPushToken`), and the server updates and ends it through APNs. The app only
/// starts, ends what it finds left over, and says when one is gone (`onEnd`).
public class LiveActivityModule: Module {
  private var watched = Set<String>()
  /// The newest token of each activity, for `onEnd`.
  private var tokens = [String: String]()
  private static let staleAfter: TimeInterval = 15 * 60

  public func definition() -> ModuleDefinition {
    Name("LiveActivity")
    Events("onPushToken", "onEnd")

    Function("available") { () -> Bool in
      ActivityAuthorizationInfo().areActivitiesEnabled
    }

    AsyncFunction("start") { (input: StartInput) throws -> String? in
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
      // One activity per run: a second send to the same run keeps the first.
      if let same = Activity<DougActivityAttributes>.activities.first(where: { $0.attributes.runId == input.runId }) {
        self.watch(same)
        return same.id
      }
      let faceFile = Self.saveFace(input.face, runId: input.runId)
      let attributes = DougActivityAttributes(
        agentName: input.agentName,
        agentColor: input.agentColor,
        faceFile: faceFile,
        orgId: input.orgId,
        runId: input.runId
      )
      let content = ActivityContent(
        state: input.state.state,
        staleDate: Date().addingTimeInterval(Self.staleAfter)
      )
      let activity = try Activity.request(attributes: attributes, content: content, pushType: .token)
      self.watch(activity)
      return activity.id
    }

    AsyncFunction("end") { (id: String, state: StateInput, now: Bool) in
      guard let activity = Activity<DougActivityAttributes>.activities.first(where: { $0.id == id }) else { return }
      await activity.end(
        ActivityContent(state: state.state, staleDate: nil),
        dismissalPolicy: now ? .immediate : .default
      )
    }

    /// The activities on the phone now: the app ends the ones the server no longer follows.
    Function("list") { () -> [[String: Any]] in
      Activity<DougActivityAttributes>.activities.map { activity in
        [
          "id": activity.id,
          "runId": activity.attributes.runId,
          "orgId": activity.attributes.orgId,
          "state": "\(activity.activityState)",
        ]
      }
    }

    OnStartObserving {
      for activity in Activity<DougActivityAttributes>.activities { self.watch(activity) }
    }
  }

  private func watch(_ activity: Activity<DougActivityAttributes>) {
    guard !watched.contains(activity.id) else { return }
    watched.insert(activity.id)
    let id = activity.id
    let attributes = activity.attributes
    Task { [weak self] in
      for await data in activity.pushTokenUpdates {
        let token = data.map { String(format: "%02x", $0) }.joined()
        self?.tokens[id] = token
        self?.sendEvent(
          "onPushToken",
          ["id": id, "token": token, "runId": attributes.runId, "orgId": attributes.orgId]
        )
      }
    }
    Task { [weak self] in
      for await state in activity.activityStateUpdates {
        if state == .dismissed || state == .ended {
          self?.sendEvent("onEnd", ["id": id, "token": self?.tokens[id] ?? "", "runId": attributes.runId])
          if let file = attributes.faceFile { Self.removeFace(file) }
          break
        }
      }
    }
  }

  /// The app group the app shares with its extensions (`group.<bundle id>`, also the share extension's).
  private static var folder: URL? {
    guard let id = Bundle.main.bundleIdentifier,
      let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.\(id)")
    else { return nil }
    let folder = base.appendingPathComponent("live")
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    return folder
  }

  private static func saveFace(_ base64: String?, runId: String) -> String? {
    guard let base64, let data = Data(base64Encoded: base64), data.count < 200_000, let folder else { return nil }
    let safe = runId.filter { $0.isLetter || $0.isNumber || $0 == "-" }
    guard !safe.isEmpty else { return nil }
    let file = "\(safe).png"
    do {
      try data.write(to: folder.appendingPathComponent(file), options: .atomic)
      return file
    } catch {
      return nil
    }
  }

  private static func removeFace(_ file: String) {
    guard let folder, !file.contains("/") else { return }
    try? FileManager.default.removeItem(at: folder.appendingPathComponent(file))
  }
}
