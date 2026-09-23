"""Offline converter checks: python -m unittest tests/perf/support/test_convert_ner_external_data.py"""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

import onnx
from onnx import TensorProto, helper, numpy_helper
import numpy as np

CONVERTER_PATH = Path(__file__).with_name("convert-ner-external-data.py")
SPEC = importlib.util.spec_from_file_location("ner_external_converter", CONVERTER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Could not load the NER external data converter.")
CONVERTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CONVERTER)


class ConverterTests(unittest.TestCase):
    def test_rejects_unpinned_input_before_creating_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "wrong.onnx"
            output = root / "output"
            source.write_bytes(b"not the pinned model")
            with self.assertRaisesRegex(CONVERTER.ConversionError, "no output was written"):
                CONVERTER.convert(source, output)
            self.assertFalse(output.exists())

    def test_rejects_external_sidecar_path_outside_output_directory(self) -> None:
        tensor = numpy_helper.from_array(np.array([1], dtype=np.float32), name="weight")
        tensor.data_location = TensorProto.EXTERNAL
        location = tensor.external_data.add()
        location.key = "location"
        location.value = "../outside.onnx_data"
        graph = helper.make_graph([], "g", [], [], [tensor])
        model = helper.make_model(graph)
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(CONVERTER.ConversionError, "escapes output directory"):
                CONVERTER.checked_sidecar_location(model, Path(temporary))

    def test_accepts_sidecar_in_output_directory(self) -> None:
        tensor = numpy_helper.from_array(np.array([1], dtype=np.float32), name="weight")
        tensor.data_location = TensorProto.EXTERNAL
        location = tensor.external_data.add()
        location.key = "location"
        location.value = "model_quantized.onnx_data"
        graph = helper.make_graph([], "g", [], [], [tensor])
        model = helper.make_model(graph)
        with tempfile.TemporaryDirectory() as temporary:
            CONVERTER.checked_sidecar_location(model, Path(temporary))


if __name__ == "__main__":
    unittest.main()
