import ActivityKit
import Foundation

/// An agent's run a person waits on, on the lock screen and in the Dynamic Island (docs/adr/doug-0021-lock-screen.md).
/// The same file is in the app's module (modules/live-activity/ios): the two must stay equal, field for field, and
/// `ContentState` must match what the server sends (`LiveState` in packages/engine/src/live-activities.ts). A test
/// keeps the copies equal.
public struct DougActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    /// What was asked, in a few words ("Lâmina 21").
    public var title: String
    /// Who waits on whom, then how far ("você está esperando · falta pouco"), in the phone's language.
    public var line: String
    /// From 0 to 1.
    public var progress: Double
    /// `queued`, `work`, `wait`, `done`, `stopped` or `failed`: the bar's color and the end.
    public var phase: String

    public init(title: String, line: String, progress: Double, phase: String) {
      self.title = title
      self.line = line
      self.progress = progress
      self.phase = phase
    }
  }

  /// The agent's name, as the team knows it.
  public var agentName: String
  /// The agent's own color ("#rrggbb").
  public var agentColor: String
  /// The agent's face, a PNG the app left in the app group's `live` folder; nil: its initial on its color.
  public var faceFile: String?
  public var orgId: String
  public var runId: String

  public init(agentName: String, agentColor: String, faceFile: String?, orgId: String, runId: String) {
    self.agentName = agentName
    self.agentColor = agentColor
    self.faceFile = faceFile
    self.orgId = orgId
    self.runId = runId
  }
}
