import SwiftUI
import WidgetKit

/// The widget extension's entry: only the Live Activity (docs/adr/doug-0021-lock-screen.md).
@main
struct DougWidgets: WidgetBundle {
  var body: some Widget {
    DougLiveActivity()
  }
}
