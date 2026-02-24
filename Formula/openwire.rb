class Openwire < Formula
  desc "P2P encrypted messenger for local networks with zero configuration"
  homepage "https://github.com/shwetanshu21/openwire"
  url "https://github.com/shwetanshu21/openwire/archive/refs/tags/v0.3.0.tar.gz"
  sha256 "df8c284599ac536ff6847091c29188c00281527dab60c74a08a9d8b7f77f0d2f"
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
