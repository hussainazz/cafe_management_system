from pathlib import Path
import subprocess
import tempfile


def test_toman_to_rial_conversion_and_bounds():
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="sep-amount-") as folder:
        exe = Path(folder) / "SepAmountTests.exe"
        subprocess.run(
            [
                "mcs",
                "-sdk:4.8",
                "-langversion:5",
                "-warnaserror",
                f"-out:{exe}",
                str(root / "Payments/SepAmount.cs"),
                str(root / "tests/SepAmountTests.cs"),
            ],
            check=True,
        )
        result = subprocess.run(["mono", str(exe)], check=True, text=True, capture_output=True)
        assert "SEP amount conversion passed" in result.stdout
