from pathlib import Path
import subprocess
import tempfile


def test_purchase_lifecycle_reinitializes_after_connection_test():
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="sep-purchase-lifecycle-") as folder:
        exe = Path(folder) / "PurchaseLifecycleTests.exe"
        subprocess.run(
            [
                "mcs",
                "-sdk:4.8",
                "-langversion:5",
                "-warnaserror",
                "-r:System.Web.Extensions",
                "-r:System.Security",
                f"-out:{exe}",
                str(root / "Payments/PaymentProtocol.cs"),
                str(root / "Payments/PurchaseLifecycle.cs"),
                str(root / "tests/PurchaseLifecycleTests.cs"),
            ],
            check=True,
        )
        result = subprocess.run(["mono", str(exe)], check=True, text=True, capture_output=True)
        assert "Purchase SDK lifecycle passed" in result.stdout
