class Openwire < Formula
  desc "P2P encrypted messenger for local networks with zero configuration"
  homepage "https://github.com/shwetanshu21/openwire"
  url "https://github.com/shwetanshu21/openwire/archive/refs/tags/v0.2.4.tar.gz"
  sha256 "f2a846f0eb3d82be91da9191a515005cbeb4b10b1dcb2a0ae81ab1bcffbc8bc3"
  license "MIT"
  head "https://github.com/shwetanshu21/openwire.git", branch: "master"

  depends_on "rust" => :build

  def install
    system "cargo", "install", *std_cargo_args
  end

  test do
    assert_match "openwire", shell_output("#{bin}/openwire --version")
  end
end
