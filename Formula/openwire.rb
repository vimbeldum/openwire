class Openwire < Formula
  desc "P2P encrypted messenger for local networks with zero configuration"
  homepage "https://github.com/vimbeldum/openwire"
  url "https://github.com/vimbeldum/openwire/archive/refs/tags/v0.9.5.tar.gz"
  sha256 "a37acf6db5b1ab6c8dbe6d336b2bfee5638061979a573cb2a4623d57836a4200"
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
