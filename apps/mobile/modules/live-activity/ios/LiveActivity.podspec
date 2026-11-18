# Live Activities (docs/adr/doug-0021-lock-screen.md): a local Expo module, linked by `expo prebuild` from
# apps/mobile/modules. The widget that draws them is the extension in apps/mobile/targets/live-activity.
Pod::Spec.new do |s|
  s.name           = 'LiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'An agent at work on the lock screen and in the Dynamic Island.'
  s.description    = s.summary
  s.license        = 'AGPL-3.0-only'
  s.author         = 'agentes.chat'
  s.homepage       = 'https://agentes.chat'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/agentes-chat/agentes-chat.git' }
  s.static_framework = true
  s.frameworks     = 'ActivityKit'

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
