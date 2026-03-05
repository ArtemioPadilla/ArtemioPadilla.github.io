# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned

### Added

- **Cron Expression Parser** lab tool (`/lab/cron-parser`) -- parse cron expressions with human-readable descriptions, visual SVG timeline (hour/day/week/month zoom), next 10 execution times with relative timestamps, frequency estimation, field-level validation with error highlighting, 12 common presets, and syntax reference. Supports all standard 5-field cron syntax: wildcards, ranges, steps, lists, and named days/months. Pure JavaScript implementation with zero external dependencies.
- **Activation Function Gallery** lab tool (`/lab/activation-functions`) — interactive visualization of 10 neural network activation functions (ReLU, Leaky ReLU, ELU, GELU, Swish/SiLU, Mish, Sigmoid, Tanh, Softplus, Step). Overlay multiple functions on same canvas with derivatives toggle, hover crosshair showing exact values, comparison presets (Classic, Modern, ReLU Family, All Smooth), configurable parameters (Leaky ReLU alpha, ELU alpha), and properties panel showing range, monotonicity, zero-centering, dead neuron risk, and computational cost. Pure Canvas 2D, zero dependencies.
- **Gradient Descent Animator** lab tool (`/lab/gradient-descent`) — visualize optimization algorithms (SGD, Momentum, Adam, AdaGrad, RMSProp) racing across 2D loss landscapes. Pure Canvas 2D rendering with heatmap, contour lines, gradient arrows, and particle trails. Supports 6 test functions (Himmelblau, Rosenbrock, Beale, Saddle Point, Bowl, Rastrigin). Adjustable hyperparameters with log-scale learning rate slider. Click canvas to set start position. No external dependencies.
- **Tokenizer Playground** lab tool (`/lab/tokenizer`) — visualize how LLM tokenizers break text into tokens with color-coded chips, BPE merge step-by-step animation, model token count comparison (GPT-4o, GPT-4, Claude 3.5, Llama 3), text statistics, and API pricing reference. Custom lightweight BPE implementation with ~200 merge rules — no external WASM dependencies.
- **Regex Tester** lab tool (`/lab/regex-tester`) — browser-based regex testing with live match highlighting, capture group visualization, replace mode, quick reference, and preset patterns
- **Neural Network Playground** lab tool (`/lab/neural-network`) — build and train small neural networks on 2D toy datasets with real-time decision boundary visualization. From-scratch implementation (forward pass, backpropagation, SGD) with zero ML library dependencies. Supports 1-4 hidden layers, 1-8 neurons per layer, ReLU/Sigmoid/Tanh activations, 6 toy datasets (Circle, XOR, Spiral, Gaussian, Moon, Linear), adjustable noise/learning rate/batch size, live loss/accuracy chart, and network architecture diagram
- **Convolution Visualizer** lab tool (`/lab/convolution-viz`) — animate how convolution kernels slide across 2D grids step by step. Features paintable input grid (6-12 adjustable), editable 3x3/5x5 kernel with presets (Identity, Edge Detect, Sharpen, Blur, Gaussian, Emboss, Sobel), stride (1/2/3), padding (none/same/full), step-by-step or auto-play animation with speed control, diverging blue-white-red output color map, and live computation display with output dimensions formula. Pure Canvas, zero dependencies
- **Loss Function Explorer** lab tool (`/lab/loss-explorer`) — interactive comparison of 8 loss functions (MSE, MAE, Huber, Binary Cross-Entropy, Categorical Cross-Entropy, Hinge, Focal, Log-Cosh). Two visualization modes: Curve mode plots loss/gradient as function of predicted value with draggable exploration line, Interactive mode shows scatter plot with draggable predictions and per-point loss bar chart. Configurable parameters (Huber delta, Focal alpha/gamma), gradient view toggle, and properties table showing symmetry, robustness, differentiability, and gradient behavior. Pure Canvas 2D, zero dependencies
- **JWT Decoder** lab tool (`/lab/jwt-decoder`) — decode and inspect JSON Web Tokens with color-coded header/payload/signature display, decoded JSON panels with syntax highlighting, live expiry countdown timer (valid/expired/not-yet-valid badges), claims table with standard claim descriptions and human-readable timestamps, 4 preset tokens (Simple User, API Access, Expired, RS256), copy buttons for each section, and standalone base64url decoder utility. Pure JS, zero dependencies, all processing client-side
- **Probability Distribution Explorer** lab tool (`/lab/distributions`) — interactive explorer for 15 probability distributions (10 continuous: Normal, Log-Normal, Exponential, Uniform, Beta, Gamma, Chi-Squared, Student's t, Cauchy, Weibull; 5 discrete: Bernoulli, Binomial, Poisson, Geometric, Negative Binomial). Features PDF/PMF and CDF views, dynamic parameter sliders, real-time statistics panel (mean, variance, std dev, skewness, kurtosis, mode, median), probability calculator with area shading, sampling visualization with histogram overlay, overlay mode to compare up to 3 distributions, and preset comparisons (Normal vs t, Poisson approx to Binomial, CLT demo). All math from scratch (Lanczos gamma, erf, incomplete beta/gamma, continued fractions). Pure Canvas 2D, zero dependencies

### Changed

### Fixed

### Security

### Removed
