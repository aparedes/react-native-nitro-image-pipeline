require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroImagePipeline"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/aparedes/react-native-nitro-image-pipeline.git", :tag => "#{s.version}" }

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Implementation (C++ objects)
    "cpp/**/*.{hpp,cpp}",
  ]

  load 'nitrogen/generated/ios/NitroImagePipeline+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  s.dependency 'NitroImage'

  spm_dependency(s,
    url: 'https://github.com/kean/Nuke',
    # 13.2.1 is the first release that honours `disableDiskCacheWrites` for
    # processed images (`cache: 'memory' | 'none'` and local sources rely on
    # it); 13.2.3 adds atomic disk-cache writes.
    requirement: { kind: 'upToNextMajorVersion', minimumVersion: '13.2.3' },
    products: ['Nuke']
  )

  install_modules_dependencies(s)
end
