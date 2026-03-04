---
title: "Hello, World"
description: "First post on this blog. A quick introduction to what I'll be writing about — deep learning, GenAI, and the bridge between physics and AI."
pubDate: 2026-03-03
tags: ["meta", "deep-learning", "genai"]
draft: false
---

## Welcome

This is the first post on my blog. I'll be writing about deep learning systems, generative AI, and the intersection of physics and machine learning.

### What to expect

- Technical deep dives into production ML systems
- Lessons from building GenAI solutions at scale
- The bridge between scientific research and engineering

### A quick code example

Here's a simple Python snippet to make sure syntax highlighting works:

```python
import torch
import torch.nn as nn

class SimpleNet(nn.Module):
    def __init__(self, input_dim: int, output_dim: int):
        super().__init__()
        self.layers = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.ReLU(),
            nn.Linear(128, output_dim),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.layers(x)

model = SimpleNet(784, 10)
print(f"Parameters: {sum(p.numel() for p in model.parameters()):,}")
```

Stay tuned for more posts.
