require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "OverTheAir"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/mohamadnavabi/react-native-over-the-air.git", :tag => "#{s.version}" }

  s.module_name = "OverTheAir"
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }

  s.source_files = "ios/**/*.{h,m,mm,swift,cpp}"

  install_modules_dependencies(s)
end
