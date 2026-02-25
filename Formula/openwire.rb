class Openwire < Formula
  desc "P2P encrypted messenger for local networks with zero configuration"
  homepage "https://github.com/vimbeldum/openwire"
  url "https://github.com/vimbeldum/openwire/archive/refs/tags/v0.4.0.tar.gz"
  sha256 "49065af089f3184368e37b8ccda3c272fb8bc9abbbb1647d8483380ed175da18"
  license "MIT"
  head "https://github.com/vimbeldum/openwire.git", branch: "master"

  depends_on "rust" => :build

  def install
    system "cargo", "install", *std_cargo_args
  end

  test do
    assert_match "openwire", shell_output("#{bin}/openwire --version")
  end
end
