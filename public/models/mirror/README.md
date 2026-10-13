# Local mirror segmentation model

This is an ONNX export of the ADE20K weights published as `openmmlab/upernet-convnext-tiny`. The model publisher explicitly marks the weight repository as MIT-licensed, permitting commercial use under those terms. The publisher's original model card is retained in `UPSTREAM_MODEL_CARD.md`; the ConvNeXt backbone's original MIT notice is retained in `LICENSE`. Primary source: https://huggingface.co/openmmlab/upernet-convnext-tiny/blob/main/README.md . The immutable source revision, source-weight hash and exported-model hash are recorded in `config.json`.

No camera images or scan geometry are included in this model. No private images were used for training or quantization calibration. Inference is intended to run locally in a browser worker; downloading the model must not transmit camera images to a service.

The export includes the backbone and segmentation decode head, excluding the training-only auxiliary head. Adaptive pooling uses mathematically equivalent dynamic slice/mean bins. Convolution and matrix-multiply weights use symmetric per-output-channel INT8 storage with DequantizeLinear nodes; activations and input/output remain FP32. This reduces download size, and does not promise integer-only computation or calibrated model probabilities.

## Input and output

- Input `pixel_values`: Float32 NCHW `[1,3,height,width]`. Use RGB order. First orient the image upright using its recovered camera pose; preserve that rotation so the mask can be mapped back to original camera pixels.
- Bilinearly resize to the chosen input size. The tested small portrait input is width 192, height 256. Width 384, height 512 is also verified. Dimensions should be multiples of 32. Normalize each channel as `(byte / 255 - mean) / std`, mean `[0.485,0.456,0.406]`, std `[0.229,0.224,0.225]`.
- Output `logits`: Float32 `[1,150,height/4,width/4]`. Compute a numerically stable softmax across 150 classes at each pixel; mirror is class 27. Labels are included in `config.json`.
- A candidate cell must both have mirror as its highest scoring class and mirror probability at least 0.6. Filter connected components smaller than `max(32, ceil(maskWidth*maskHeight*0.01))`. These are conservative candidate filters, not a calibrated guarantee.
- Return candidate mask coordinates through the inverse resize/rotation to the original camera coordinate system before intersecting with measured walls. Mask boundaries and reflected-image holes are not verified physical mirror edges. Require independent camera and wall evidence before rendering derived geometry.

## Verification and runtime limits

Local CPU checks compare the unquantized export against PyTorch at both input sizes and the quantized model against those results. The quantized model retains the detected mirror in frontal and oblique views and rejects the reviewed toilet views after component filtering. These are limited scene checks, not a general mirror-detection accuracy benchmark. Mobile WebKit memory, latency and failure recovery require separate device verification.

Load lazily, process sequentially in one worker, bound image counts and inference time, and release the worker/session afterward. Keep source images, mesh positions, captured wall geometry and construction estimates independent of this optional inferred detail. Do not fall back to a fabricated mirror when detection is inconclusive.
