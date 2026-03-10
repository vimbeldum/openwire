class Openwire < Formula
  desc "P2P encrypted messenger for local networks with zero configuration"
  homepage "https://github.com/vimbeldum/openwire"
  url "https://github.com/vimbeldum/openwire/archive/refs/tags/v0.9.5.tar.gz"
  sha256 "39a132e0b82d41ee2f69da2843926372d4480be350bcd153c28a47d63091d740"
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
