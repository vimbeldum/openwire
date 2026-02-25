class Openwire < Formula
  desc "P2P encrypted messenger for local networks with zero configuration"
  homepage "https://github.com/vimbeldum/openwire"
  url "https://github.com/vimbeldum/openwire/archive/refs/tags/v0.3.1.tar.gz"
  sha256 "9c89b6ee85cf0c49b167eb73e358e756dc6ffa11f96f602b9fd2f8fc3a071426"
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
