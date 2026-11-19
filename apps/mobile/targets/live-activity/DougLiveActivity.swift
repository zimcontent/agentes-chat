import ActivityKit
import SwiftUI
import WidgetKit

/// An agent at work on what the person asked, on the lock screen and in the Dynamic Island
/// (docs/adr/doug-0021-lock-screen.md): its face, "ROSA · Lâmina 21", who waits on whom and how far, and a progress
/// line. Colors are the identity's stage, ink and green (apps/mobile/src/brand/tokens.ts, `DB_DARK`).
struct DougLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: DougActivityAttributes.self) { context in
      LockScreenView(context: context)
        .activityBackgroundTint(Palette.stage.opacity(0.92))
        .activitySystemActionForegroundColor(Palette.ink)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Face(attributes: context.attributes, size: 40).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 2) {
            Heading(context: context)
            Text(context.state.line).font(.system(size: 13)).foregroundStyle(Palette.ink2).lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.bottom) {
          ProgressLine(state: context.state, color: Palette.bar(context.state.phase, agent: context.attributes.agentColor))
            .padding(.top, 6)
        }
      } compactLeading: {
        Face(attributes: context.attributes, size: 22)
      } compactTrailing: {
        Ring(state: context.state, color: Palette.bar(context.state.phase, agent: context.attributes.agentColor))
      } minimal: {
        Face(attributes: context.attributes, size: 22)
      }
      .keylineTint(Palette.color(hex: context.attributes.agentColor) ?? Palette.green)
    }
  }
}

private struct LockScreenView: View {
  let context: ActivityViewContext<DougActivityAttributes>

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      Face(attributes: context.attributes, size: 44)
      VStack(alignment: .leading, spacing: 4) {
        Heading(context: context)
        Text(context.state.line).font(.system(size: 14)).foregroundStyle(Palette.ink2).lineLimit(1)
        ProgressLine(state: context.state, color: Palette.bar(context.state.phase, agent: context.attributes.agentColor))
          .padding(.top, 6)
      }
    }
    .padding(.horizontal, 18)
    .padding(.vertical, 16)
  }
}

/// "ROSA · Lâmina 21": the agent's name in capitals, then what was asked.
private struct Heading: View {
  let context: ActivityViewContext<DougActivityAttributes>

  var body: some View {
    let name = context.attributes.agentName.uppercased()
    let title = context.state.title
    Text(title.isEmpty ? name : "\(name) · \(title)")
      .font(.system(size: 16, weight: .semibold))
      .foregroundStyle(Palette.ink)
      .lineLimit(1)
  }
}

private struct ProgressLine: View {
  let state: DougActivityAttributes.ContentState
  let color: Color

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().fill(Palette.track)
        Capsule().fill(color).frame(width: max(6, geo.size.width * min(1, max(0, state.progress))))
      }
    }
    .frame(height: 5)
  }
}

private struct Ring: View {
  let state: DougActivityAttributes.ContentState
  let color: Color

  var body: some View {
    ZStack {
      Circle().stroke(Palette.track, lineWidth: 3)
      Circle()
        .trim(from: 0, to: min(1, max(0.04, state.progress)))
        .stroke(color, style: StrokeStyle(lineWidth: 3, lineCap: .round))
        .rotationEffect(.degrees(-90))
    }
    .frame(width: 18, height: 18)
  }
}

/// The agent's face from the app group (the app drew it from the agent's look), else its initial on its color.
private struct Face: View {
  let attributes: DougActivityAttributes
  let size: CGFloat

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
    if let image = FaceStore.image(named: attributes.faceFile) {
      Image(uiImage: image).resizable().interpolation(.high).scaledToFit().frame(width: size, height: size)
    } else {
      let color = Palette.color(hex: attributes.agentColor) ?? Palette.green
      shape.fill(color)
        .frame(width: size, height: size)
        .overlay(
          Text(String(attributes.agentName.prefix(1)).uppercased())
            .font(.system(size: size * 0.46, weight: .bold))
            .foregroundStyle(Palette.stage)
        )
    }
  }
}

enum FaceStore {
  /// The app group the app shares with its extensions: `group.<the app's bundle id>`.
  static var group: String? {
    guard let id = Bundle.main.bundleIdentifier, let dot = id.lastIndex(of: ".") else { return nil }
    return "group.\(id[..<dot])"
  }

  static func image(named file: String?) -> UIImage? {
    guard let file, !file.contains("/"), let group,
      let folder = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return UIImage(contentsOfFile: folder.appendingPathComponent("live").appendingPathComponent(file).path)
  }
}

enum Palette {
  static let stage = Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x12 / 255)
  static let ink = Color(red: 0xED / 255, green: 0xED / 255, blue: 0xED / 255)
  static let ink2 = Color(red: 0x99 / 255, green: 0x99 / 255, blue: 0x99 / 255)
  static let track = Color(red: 0x30 / 255, green: 0x30 / 255, blue: 0x30 / 255)
  static let green = Color(red: 0x9C / 255, green: 0xFA / 255, blue: 0x05 / 255)
  static let attention = Color(red: 0xF5 / 255, green: 0xB5 / 255, blue: 0x44 / 255)
  static let error = Color(red: 0xF2 / 255, green: 0x55 / 255, blue: 0x5A / 255)

  /// The bar: the ink while it works, amber while it waits on the person, green when done, red when it didn't finish.
  static func bar(_ phase: String, agent: String) -> Color {
    switch phase {
    case "wait": return attention
    case "done": return green
    case "failed": return error
    case "stopped": return ink2
    default: return ink
    }
  }

  static func color(hex: String) -> Color? {
    let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
    return Color(
      red: Double((value >> 16) & 0xFF) / 255,
      green: Double((value >> 8) & 0xFF) / 255,
      blue: Double(value & 0xFF) / 255
    )
  }
}
