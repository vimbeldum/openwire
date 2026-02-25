# Contributing to OpenWire

First off, thanks for taking the time to contribute! OpenWire is a community-driven project and we welcome contributions of all kinds.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Development Workflow](#development-workflow)
- [Coding Standards](#coding-standards)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed and expected**
- **Include screenshots or animated GIFs if helpful**
- **Include your environment details** (OS, Rust version, etc.)

Use the [Bug Report Template](.github/ISSUE_TEMPLATE/bug_report.md).

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Provide specific examples to demonstrate the expected behavior**
- **Explain why this enhancement would be useful**
- **List any other applications that have this feature, if applicable**

Use the [Feature Request Template](.github/ISSUE_TEMPLATE/feature_request.md).

### Pull Requests

- Fill in the required template
- Do not include issue numbers in the PR title
- Include screenshots and animated GIFs in your pull request whenever possible
- Follow the coding standards
- Include tests for new functionality
- Update documentation for changed functionality

## Development Setup

### Prerequisites

- **Rust**: Install using [rustup](https://rustup.rs/)
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```

- **Git**: For version control

- **pre-commit** (recommended): Catches issues before committing
  ```bash
  pip install pre-commit
  ```

### Clone and Build

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/openwire.git
cd openwire

# Add upstream remote
git remote add upstream https://github.com/vimbeldum/openwire.git

# Install pre-commit hooks (recommended)
pre-commit install

# Build the project
cargo build

# Run tests
cargo test

# Run the application
cargo run
```

### Running with Options

```bash
# Run with a custom nickname
cargo run -- --nick "YourName"

# Enable the web interface
cargo run -- --web --web-port 3000

# Connect to a bootstrap peer
cargo run -- --bootstrap "/ip4/192.168.1.100/tcp/0/p2p/PEER_ID"

# Run with debug logging
cargo run -- --log-level debug
```

## Development Workflow

1. **Fork** the repository on GitHub
2. **Clone** your fork locally
3. **Create a branch** for your changes
   ```bash
   git checkout -b feature/my-new-feature
   ```
4. **Make your changes** following our coding standards
5. **Test your changes**
   ```bash
   cargo test
   cargo clippy
   cargo fmt --check
   ```
6. **Commit your changes** with a clear commit message
7. **Push to your fork**
   ```bash
   git push origin feature/my-new-feature
   ```
8. **Open a Pull Request** against the `master` branch

## Coding Standards

### Rust Style

- Follow the standard Rust formatting guidelines
- Run `cargo fmt` before committing
- Address all `cargo clippy` warnings
- Use meaningful variable and function names
- Add documentation comments (`///`) for public APIs

### Code Organization

- Keep modules focused and cohesive
- Place tests in the same file as the code they test (using `#[cfg(test)]`)
- Use ` anyhow::Result` for application errors
- Use `thiserror` for library errors when appropriate

### Security

- Never commit secrets, keys, or credentials
- Be mindful of cryptographic best practices
- Validate all external inputs
- Report security vulnerabilities privately (see [SECURITY.md](SECURITY.md))

## Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

### Commit Message Format

```
<type>: <subject>

<body>

<footer>
```

Types:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Formatting, missing semicolons, etc.
- `refactor`: Code restructuring without changing behavior
- `test`: Adding or modifying tests
- `chore`: Maintenance tasks

## Pull Request Process

1. **Update Documentation**: Ensure any new features or changed behavior is documented in README.md

2. **Update Changelog**: Add an entry to CHANGELOG.md under the "Unreleased" section

3. **Pass CI Checks**: All tests, clippy warnings, and formatting checks must pass

4. **Code Review**: At least one maintainer must approve your PR

5. **Squash Commits**: Your PR may be squash-merged into a single commit

### PR Checklist

- [ ] Code compiles without errors (`cargo build`)
- [ ] Tests pass (`cargo test`)
- [ ] No clippy warnings (`cargo clippy`)
- [ ] Code is formatted (`cargo fmt`)
- [ ] Documentation is updated
- [ ] CHANGELOG.md is updated
- [ ] Commit messages follow our guidelines

## Questions?

Feel free to open an issue with the "question" label or start a discussion in the Discussions tab.

Thank you for contributing to OpenWire!
