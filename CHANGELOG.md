# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

### Added

- **Gradient Descent Animator** lab tool (`/lab/gradient-descent`) — visualize optimization algorithms (SGD, Momentum, Adam, AdaGrad, RMSProp) racing across 2D loss landscapes. Pure Canvas 2D rendering with heatmap, contour lines, gradient arrows, and particle trails. Supports 6 test functions (Himmelblau, Rosenbrock, Beale, Saddle Point, Bowl, Rastrigin). Adjustable hyperparameters with log-scale learning rate slider. Click canvas to set start position. No external dependencies.
- **Tokenizer Playground** lab tool (`/lab/tokenizer`) — visualize how LLM tokenizers break text into tokens with color-coded chips, BPE merge step-by-step animation, model token count comparison (GPT-4o, GPT-4, Claude 3.5, Llama 3), text statistics, and API pricing reference. Custom lightweight BPE implementation with ~200 merge rules — no external WASM dependencies.
- **Regex Tester** lab tool (`/lab/regex-tester`) — browser-based regex testing with live match highlighting, capture group visualization, replace mode, quick reference, and preset patterns
- **Neural Network Playground** lab tool (`/lab/neural-network`) — build and train small neural networks on 2D toy datasets with real-time decision boundary visualization. From-scratch implementation (forward pass, backpropagation, SGD) with zero ML library dependencies. Supports 1-4 hidden layers, 1-8 neurons per layer, ReLU/Sigmoid/Tanh activations, 6 toy datasets (Circle, XOR, Spiral, Gaussian, Moon, Linear), adjustable noise/learning rate/batch size, live loss/accuracy chart, and network architecture diagram

### Changed

### Fixed

### Security

### Removed
