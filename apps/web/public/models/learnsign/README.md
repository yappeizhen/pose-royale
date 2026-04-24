# LearnSign models

Public-served TensorFlow.js model artifacts for the LearnSign game. Two
layouts, one backend each:

```
public/models/learnsign/
├── model.json                    # IMAGE backend — SSD MobileNet v2 from
├── group1-shard1of3.bin          # ngzhili/LearnSign. Takes raw RGB frames,
├── group1-shard2of3.bin          # produces 25-class detections (background +
├── group1-shard3of3.bin          # 24 letters). ~12 MB, zero training needed.
└── sign-classifier/              # LANDMARK backend — small MLP trained on
    ├── model.json                # normalized MediaPipe landmarks. ~20 KB,
    └── group1-shard1of1.bin      # needs training (see TRAINING.md).
```

## Which one does the game load?

Controlled by `VITE_LEARNSIGN_BACKEND` in `.env.local`:

| Backend       | Selects                         | Needs TF.js? | Needs training? | Download |
| ------------- | ------------------------------- | ------------ | --------------- | -------- |
| `image`       | (default) `model.json` (SSD MobileNet) | yes   | no              | ~12 MB   |
| `landmark`    | `sign-classifier/model.json`    | yes          | yes             | ~20 KB   |
| `heuristic`   | rule-based detector, no model   | no           | no              | 0 B      |

```bash
# Stay on the shipped SSD (already the default):
VITE_LEARNSIGN_BACKEND=image
# Or point at a different image model:
VITE_LEARNSIGN_IMAGE_MODEL_URL=/models/learnsign/experiments/my-ssd/model.json

# Or, once you've trained one, use the lighter landmark MLP:
VITE_LEARNSIGN_BACKEND=landmark
VITE_LEARNSIGN_MODEL_URL=/models/learnsign/sign-classifier/model.json

# Or drop TF.js entirely and run the offline heuristic:
VITE_LEARNSIGN_BACKEND=heuristic
```

Both ML backends dynamically import `@tensorflow/tfjs`. The package is declared
in `games/learnsign/package.json`, so a fresh `pnpm install` wires it in
automatically. If the local install fails (e.g. offline, registry flaky), the
detector transparently falls back to the `esm.sh` CDN build at runtime — or you
can opt out entirely with `VITE_LEARNSIGN_BACKEND=heuristic`.

## Trade-offs: image vs. landmark

The image backend ("just use the LearnSign model") is the fastest path to
something working — the weights are already committed and there's nothing to
train. The cost:

- **Bundle**: ~12 MB on first load vs. ~20 KB for the landmark MLP.
- **Compute**: SSD MobileNet does its own hand detection every inference,
  duplicating what MediaPipe already did for us. On mid-tier laptops expect
  ~30–50 ms/inference on WebGL.
- **Iterability**: retraining the image model means re-doing the whole TF
  Object Detection pipeline. The landmark MLP retrains in minutes on Colab
  (see `games/learnsign/TRAINING.md`).

Use the image backend when you want zero-setup accuracy. Move to the landmark
backend when you want the smallest download and headroom for other GPU work.

## How do I make a new `sign-classifier/` model?

See `games/learnsign/TRAINING.md`. tl;dr:

1. Grab the [Kaggle ASL Alphabet dataset](https://www.kaggle.com/datasets/grassknoted/asl-alphabet).
2. Run the preprocessing script in the Colab — it turns each image into the
   same 63-length landmark vector the runtime uses.
3. Train the tiny MLP (a few minutes on any Colab GPU).
4. Export with `tensorflowjs_converter`.
5. Drop the resulting `model.json` + weight shards into `sign-classifier/`.
