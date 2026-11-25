import importlib.util
import sys
import unittest
from pathlib import Path


script_path = Path(__file__).parents[1] / "menu-analytics.py"
spec = importlib.util.spec_from_file_location("cafe_menu_analytics", script_path)
analytics = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = analytics
spec.loader.exec_module(analytics)


class ProductMediaClassificationTests(unittest.TestCase):
    def test_canonical_bundled_and_uploaded_media_are_image_payloads(self):
        for path in (
            "/media/products/bundled/" + "a" * 64 + ".webp",
            "/media/products/uploads/00000000-0000-4000-8000-000000000001.png",
        ):
            with self.subTest(path=path):
                self.assertEqual(analytics.classify_payload(path, "image/webp"), "images")
                self.assertTrue(analytics.is_menu_service_path(path))

    def test_legacy_product_image_paths_remain_classified(self):
        for path in (
            "/items_pictures/turkish.webp",
            "/items/آمریکانو.webp",
        ):
            with self.subTest(path=path):
                self.assertEqual(analytics.classify_payload(path, "image/webp"), "images")
                self.assertTrue(analytics.is_menu_service_path(path))

    def test_pos_paths_are_not_menu_service_traffic(self):
        self.assertFalse(analytics.is_menu_service_path("/pos/media/products/uploads/example.webp"))


if __name__ == "__main__":
    unittest.main()
