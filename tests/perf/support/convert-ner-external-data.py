#!/usr/bin/env python3
"""Repack the pinned NER ONNX file without changing its graph or weights."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import sys
from pathlib import Path

import onnx
from onnx import TensorProto

SOURCE_SHA256 = "5b65139844be260b624a2a13782b01d122e613d64ce16ed0ba4d82e0b816f1a9"
MODEL_SHA256 = "212d5c76983e8e0a97a60d4e6733975980ccdc0792f335a590c503f92ee24d49"
DATA_SHA256 = "abe8b9215a0dcbf20cd1e48758d927ce974f6dc373b3171360848ee5890e8e52"
MODEL_BYTES = 871_928
DATA_BYTES = 177_637_924
SIDECAR_NAME = "model_quantized.onnx_data"
VERSIONS = {
    "onnx": "1.22.0",
    "numpy": "2.5.3",
    "protobuf": "7.36.2",
    "ml_dtypes": "0.6.0",
    "typing_extensions": "4.16.0",
}


class ConversionError(Exception):
    """Input, toolchain, or generated model does not match the ADR pin."""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_toolchain() -> None:
    if sys.version_info[:2] != (3, 12):
        raise ConversionError(f"Python 3.12 is required; got {sys.version.split()[0]}.")
    for distribution, expected in VERSIONS.items():
        actual = importlib.metadata.version(distribution)
        if actual != expected:
            raise ConversionError(f"{distribution}=={expected} is required; got {actual}.")


def checked_sidecar_location(model: onnx.ModelProto, output_dir: Path) -> None:
    for tensor in _all_tensors(model):
        for item in tensor.external_data:
            if item.key != "location":
                continue
            location = Path(item.value)
            if location.is_absolute() or ".." in location.parts:
                raise ConversionError(f"External data path escapes output directory: {item.value!r}.")
            if (output_dir / location).resolve().parent != output_dir.resolve():
                raise ConversionError(f"External data path escapes output directory: {item.value!r}.")


def _all_tensors(model: onnx.ModelProto):
    graph = model.graph
    yield from graph.initializer
    for node in graph.node:
        for attribute in node.attribute:
            if attribute.type == onnx.AttributeProto.TENSOR:
                yield attribute.t
            elif attribute.type == onnx.AttributeProto.TENSORS:
                yield from attribute.tensors
            elif attribute.type == onnx.AttributeProto.GRAPH:
                yield from _all_tensors(onnx.helper.make_model(attribute.g))
            elif attribute.type == onnx.AttributeProto.GRAPHS:
                for nested_graph in attribute.graphs:
                    yield from _all_tensors(onnx.helper.make_model(nested_graph))


def _inline_tensor_bytes(tensor: TensorProto) -> bytes:
    copy = TensorProto()
    copy.CopyFrom(tensor)
    copy.ClearField("external_data")
    copy.data_location = TensorProto.DEFAULT
    return copy.SerializeToString(deterministic=True)


def assert_same_graph_and_initializers(source: onnx.ModelProto, converted: onnx.ModelProto) -> None:
    if len(source.graph.node) != 1516 or len(converted.graph.node) != 1516:
        raise ConversionError("The graph must contain exactly 1516 nodes.")
    source_tensors = list(source.graph.initializer)
    converted_tensors = list(converted.graph.initializer)
    if len(source_tensors) != 352 or len(converted_tensors) != 352:
        raise ConversionError("The graph must contain exactly 352 initializers.")
    for index, (expected, actual) in enumerate(zip(source_tensors, converted_tensors, strict=True)):
        if expected.name != actual.name:
            raise ConversionError(f"Initializer {index} changed order or name.")
        if _inline_tensor_bytes(expected) != _inline_tensor_bytes(actual):
            raise ConversionError(f"Initializer {expected.name!r} bytes or metadata changed.")


def convert(source_path: Path, output_dir: Path) -> tuple[Path, Path]:
    verify_toolchain()
    source_path = source_path.resolve()
    output_dir = output_dir.resolve()
    if not source_path.is_file():
        raise ConversionError(f"Source model does not exist: {source_path}.")
    if sha256(source_path) != SOURCE_SHA256:
        raise ConversionError("Source ONNX SHA-256 does not match ADR-173; no output was written.")
    model_path = output_dir / "model_quantized.onnx"
    sidecar_path = output_dir / SIDECAR_NAME
    if source_path in (model_path.resolve(), sidecar_path.resolve()):
        raise ConversionError("Source model must not be inside the output directory.")

    output_dir.mkdir(parents=True, exist_ok=True)
    model = onnx.load(str(source_path))
    onnx.save_model(
        model,
        str(model_path),
        save_as_external_data=True,
        all_tensors_to_one_file=True,
        location=SIDECAR_NAME,
        size_threshold=0,
        convert_attribute=False,
    )
    checked_sidecar_location(onnx.load(str(model_path), load_external_data=False), output_dir)
    onnx.checker.check_model(str(model_path))
    source_reload = onnx.load(str(source_path))
    output_reload = onnx.load(str(model_path))
    assert_same_graph_and_initializers(source_reload, output_reload)

    actual = ((model_path, MODEL_BYTES, MODEL_SHA256), (sidecar_path, DATA_BYTES, DATA_SHA256))
    for path, expected_bytes, expected_digest in actual:
        if not path.is_file():
            raise ConversionError(f"Expected output file is missing: {path.name}.")
        if path.stat().st_size != expected_bytes or sha256(path) != expected_digest:
            raise ConversionError(f"Output {path.name} size or SHA-256 differs from ADR-173.")
    return model_path, sidecar_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()
    try:
        model, sidecar = convert(args.source, args.output_dir)
    except (ConversionError, OSError, onnx.OnnxError) as error:
        parser.error(str(error))
    print(f"{model.stat().st_size} {sha256(model)} {model}")
    print(f"{sidecar.stat().st_size} {sha256(sidecar)} {sidecar}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
