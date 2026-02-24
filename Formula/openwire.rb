class Openwire < Formula
  desc "P2P encrypted messenger for local networks with zero configuration"
  homepage "https://github.com/shwetanshu21/openwire"
  url "https://github.com/shwetanshu21/openwire/archive/refs/tags/v0.2.1.tar.gz"
  sha256 "581f8247d8360efcd7b60d35bd7ff1df00e747b8bfb630eb0845d71bb4db6c46"
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
