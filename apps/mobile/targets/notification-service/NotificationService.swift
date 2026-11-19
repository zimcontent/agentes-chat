import UserNotifications

/// A push about a live block brings its buttons' words (`actions` beside `aps`, docs/adr/doug-0021-lock-screen.md):
/// they are registered here as the push's category, so the notification shows them. A button that answers on its own
/// asks the phone to be unlocked first and leaves the app closed; "Abrir" opens it. Anything else passes untouched.
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?

  /// Categories of block buttons kept at once: older ones go, the app's own stay.
  private static let keptBlockCategories = 24
  private static let blockPrefix = "doug.block."

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      contentHandler(request.content)
      return
    }
    bestAttempt = content
    let category = content.categoryIdentifier
    let raw = content.userInfo["actions"] as? [[String: Any]] ?? []
    let actions: [UNNotificationAction] = raw.prefix(4).compactMap { item in
      guard let id = item["id"] as? String, let title = item["title"] as? String, !id.isEmpty, !title.isEmpty
      else { return nil }
      let background = item["background"] as? Bool ?? false
      let options: UNNotificationActionOptions = background ? [.authenticationRequired] : [.foreground]
      return UNNotificationAction(identifier: id, title: String(title.prefix(40)), options: options)
    }
    guard category.hasPrefix(Self.blockPrefix), !actions.isEmpty else {
      contentHandler(content)
      return
    }
    let center = UNUserNotificationCenter.current()
    center.getNotificationCategories { existing in
      var others = existing.filter { $0.identifier != category }
      let blocks = others.filter { $0.identifier.hasPrefix(Self.blockPrefix) }
      if blocks.count >= Self.keptBlockCategories {
        // No order is kept: past the cap, the block categories start over (a shown notification keeps its buttons).
        others = others.filter { !$0.identifier.hasPrefix(Self.blockPrefix) }
      }
      others.insert(UNNotificationCategory(identifier: category, actions: actions, intentIdentifiers: [], options: []))
      center.setNotificationCategories(others)
      // The system reads the categories as it shows the notification: a moment for the new one to land.
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { contentHandler(content) }
    }
  }

  override func serviceExtensionTimeWillExpire() {
    if let contentHandler, let bestAttempt { contentHandler(bestAttempt) }
  }
}
