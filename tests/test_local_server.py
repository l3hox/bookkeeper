import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

import local_server  # noqa: E402

SAMPLE_INVOICE = json.loads((Path(__file__).parent / "fixtures" / "sample-invoice.json").read_text(encoding="utf-8"))


class DataDirectoryTestCase(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temporary.name).resolve()
        self.store = local_server.DataStore(self.data_dir)

    def tearDown(self):
        self.temporary.cleanup()

    def trash_files(self, folder):
        return sorted(path.name for path in (self.data_dir / "trash" / folder).glob("*.json"))


class PathValidationTests(DataDirectoryTestCase):
    def test_a_relative_path_inside_the_data_dir_resolves_under_it(self):
        resolved = local_server.resolve_inside(self.data_dir, "invoices", "20260001.json")
        self.assertEqual(resolved, self.data_dir / "invoices" / "20260001.json")

    def test_a_parent_traversal_is_refused(self):
        with self.assertRaisesRegex(local_server.DataError, "escapes the data directory"):
            local_server.resolve_inside(self.data_dir, "invoices", "..", "..", "etc", "passwd")

    def test_a_symlink_pointing_outside_is_refused(self):
        outside = tempfile.TemporaryDirectory()
        self.addCleanup(outside.cleanup)
        (self.data_dir / "invoices" / "escape").symlink_to(outside.name)
        with self.assertRaisesRegex(local_server.DataError, "escapes the data directory"):
            local_server.resolve_inside(self.data_dir, "invoices", "escape", "x.json")

    def test_file_names_allow_invoice_numbers_and_refuse_separators(self):
        self.assertEqual(local_server.file_name_for("20260001"), "20260001.json")
        for unusable in ("../20260001", "a/b", "", ".hidden", 42):
            with self.assertRaises(local_server.DataError):
                local_server.file_name_for(unusable)

    def test_an_invoice_with_an_unusable_number_is_filed_under_its_id(self):
        self.assertEqual(local_server.invoice_file_stem({"id": "abc", "number": "2026/01"}), "abc")
        self.assertEqual(local_server.invoice_file_stem({"id": "abc", "number": "20260001"}), "20260001")

    def test_only_the_app_shell_and_its_assets_are_served(self):
        root = local_server.APP_ROOT.resolve()
        served = local_server.AppRequestHandler.is_app_file
        self.assertTrue(served(root))
        self.assertTrue(served(root / "index.html"))
        self.assertTrue(served(root / "app" / "js" / "store.js"))
        self.assertFalse(served(root / "server" / "local_server.py"))
        self.assertFalse(served(root / ".git" / "config"))
        self.assertFalse(served((root / "app" / ".." / "Makefile").resolve()))

    def test_a_data_dir_inside_the_repository_is_refused(self):
        with self.assertRaises(SystemExit):
            local_server.refuse_data_dir_inside_repository(local_server.APP_ROOT / "data")


class AtomicWriteTests(DataDirectoryTestCase):
    def test_a_write_replaces_the_file_with_the_full_payload_and_leaves_no_temporary(self):
        target = self.data_dir / "settings.json"
        local_server.write_atomically(target, b'{"a": 1}\n')
        local_server.write_atomically(target, b'{"a": 2}\n')
        self.assertEqual(target.read_bytes(), b'{"a": 2}\n')
        self.assertEqual([path.name for path in self.data_dir.glob(".tmp-*")], [])

    def test_a_failed_write_keeps_the_previous_file_and_removes_the_temporary(self):
        target = self.data_dir / "settings.json"
        local_server.write_atomically(target, b'{"a": 1}\n')
        with mock.patch.object(local_server.os, "replace", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                local_server.write_atomically(target, b'{"a": 2}\n')
        self.assertEqual(target.read_bytes(), b'{"a": 1}\n')
        self.assertEqual([path.name for path in self.data_dir.glob(".tmp-*")], [])


class CollectionTests(DataDirectoryTestCase):
    def save_invoices(self, invoices):
        self.store.save_collection("invoices", invoices, local_server.invoice_file_stem)

    def test_each_invoice_is_one_readable_file_named_by_its_number(self):
        self.save_invoices([SAMPLE_INVOICE])
        written = json.loads((self.data_dir / "invoices" / "20260001.json").read_text(encoding="utf-8"))
        self.assertEqual(written, SAMPLE_INVOICE)
        self.assertEqual(self.store.state()["invoices"], [SAMPLE_INVOICE])

    def test_a_changed_invoice_keeps_its_previous_version_in_trash(self):
        self.save_invoices([SAMPLE_INVOICE])
        changed = {**SAMPLE_INVOICE, "note": "Opravená poznámka"}
        self.save_invoices([changed])
        self.assertEqual(self.store.state()["invoices"][0]["note"], "Opravená poznámka")
        trashed = self.trash_files("invoices")
        self.assertEqual(len(trashed), 1)
        self.assertTrue(trashed[0].startswith("20260001-"))

    def test_an_unchanged_save_writes_nothing_new(self):
        self.save_invoices([SAMPLE_INVOICE])
        self.save_invoices([SAMPLE_INVOICE])
        self.assertEqual(self.trash_files("invoices"), [])

    def test_a_renumbered_invoice_moves_its_file_and_trashes_the_old_name(self):
        self.save_invoices([SAMPLE_INVOICE])
        self.save_invoices([{**SAMPLE_INVOICE, "number": "20260002"}])
        self.assertEqual(sorted(path.name for path in (self.data_dir / "invoices").glob("*.json")), ["20260002.json"])
        self.assertEqual(len(self.trash_files("invoices")), 1)

    def test_a_removed_invoice_goes_to_trash_and_is_never_deleted(self):
        self.save_invoices([SAMPLE_INVOICE])
        self.save_invoices([])
        self.assertEqual(self.store.state()["invoices"], [])
        self.assertEqual(len(self.trash_files("invoices")), 1)

    def test_two_invoices_with_one_number_are_refused_before_anything_is_written(self):
        second = {**SAMPLE_INVOICE, "id": "test-invoice-2"}
        with self.assertRaisesRegex(local_server.DataError, "map to 20260001.json"):
            self.save_invoices([SAMPLE_INVOICE, second])
        self.assertEqual(list((self.data_dir / "invoices").glob("*.json")), [])

    def test_two_invoices_that_swap_numbers_keep_their_own_content(self):
        first = {**SAMPLE_INVOICE, "id": "first", "number": "20260001", "note": "první"}
        second = {**SAMPLE_INVOICE, "id": "second", "number": "20260002", "note": "druhá"}
        self.save_invoices([first, second])
        self.save_invoices([{**first, "number": "20260002"}, {**second, "number": "20260001"}])
        by_number = {invoice["number"]: invoice["note"] for invoice in self.store.state()["invoices"]}
        self.assertEqual(by_number, {"20260002": "první", "20260001": "druhá"})

    def test_settings_must_be_an_object(self):
        with self.assertRaisesRegex(local_server.DataError, "must be an object"):
            self.store.save_object("settings", [])


if __name__ == "__main__":
    unittest.main()
