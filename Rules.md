# Project Rules and Quality Strategy

## 1. Purpose

This file defines the rules for designing, implementing, testing, and documenting
this university project. It must be reviewed before each milestone and used as the
final quality checklist before any milestone is considered complete.

The goal is an intentional, understandable student codebase. This is not a method
for bypassing AI-detection systems. The student must understand, justify, and be
able to explain every submitted file, dependency, design choice, and result.

## 2. Core rules

1. Add only what the current approved requirement needs.
2. Do not add dead code, unused imports, unused variables, placeholder functions,
   abandoned experiments, or speculative features.
3. Do not introduce circular dependencies.
4. Do not add duplicate implementations of the same responsibility.
5. Prefer the simplest correct solution. Do not create an abstraction before it
   has a clear purpose.
6. Each source file must have one clear responsibility and a name that describes
   that responsibility.
7. Keep related logic together. Split a file only when doing so makes the code
   easier to understand, test, or reuse.
8. Imports must be explicit, used, and organised consistently. An import-sharing
   or barrel file may be created only when it provides a real, explainable module
   boundary; it must not exist merely to shorten imports.
9. Dependencies must point in one clear direction, such as application code using
   domain code and domain code using shared contracts. Lower-level modules must
   not import higher-level application modules.
10. Do not add a package or library when the required behaviour can be implemented
    clearly with the language or tools already in the project.

## 3. Comments and naming

- Use descriptive names based on the project domain.
- Avoid vague names such as `data`, `temp`, `helper`, `manager`, or `process` when a
  more precise name is available.
- Comments should explain a reason, constraint, assumption, formula, or unusual
  decision. They should not repeat what an obvious line of code already says.
- Do not add large decorative comment blocks, tutorial-style narration, or comments
  claiming that code is "production ready".
- Public functions and important domain types should be understandable from their
  names and interfaces. Add a short comment only when the contract is not obvious.
- Use one consistent language, spelling style, formatting style, and naming
  convention throughout the project.

## 4. File and abstraction rules

Before creating a file, answer all of the following:

- Which requirement needs this file?
- Does an existing file already own this responsibility?
- Will the proposed name accurately describe its contents?
- Can the file be independently tested or clearly exercised?
- Can the student explain why this boundary exists?

Do not create catch-all files such as `utils`, `common`, or `helpers` unless their
contents form a genuinely related and stable responsibility. Do not create empty
directories, placeholder files, future service layers, or interfaces with only one
meaningless implementation.

## 5. Scope and university readiness

This project is university-ready, not production-ready, until the scope is
explicitly changed. Do not add the following unless an assessment requirement or
an approved later milestone needs them:

- Dockerfiles or container orchestration
- CI/CD workflows
- deployment YAML files
- Kubernetes, Terraform, or other infrastructure configuration
- cloud resources
- production monitoring or alerting
- release automation
- speculative authentication or administration systems
- generated architecture layers that are not used by the current application

Necessary local configuration, dependency manifests, formatting configuration,
and test configuration are allowed when they directly support building, running,
or assessing the project.

## 6. Testing strategy

Tests should prove behaviour rather than copy the implementation.

For each feature, include only the relevant categories:

1. A normal successful case.
2. An important boundary or edge case.
3. A realistic invalid-input or failure case.
4. A regression test when a genuine defect has been found.

Testing rules:

- Tests must be deterministic and repeatable.
- Test names must state the expected behaviour in plain language.
- Tests must use realistic, minimal fixtures.
- Do not test private implementation details.
- Do not add meaningless assertions only to increase test or coverage counts.
- Avoid excessive mocks. Use a mock only when the real boundary is slow,
  unreliable, destructive, or outside the feature being tested.
- Every test must be capable of failing for a relevant defect.
- Remove obsolete tests when the approved behaviour changes.
- The complete test suite must pass before a milestone is marked complete.

## 7. Quality checks for every change

Before completing a change:

- Confirm that it implements only the agreed scope.
- Run the relevant formatter, static checks, build, and tests.
- Check for unused code and imports.
- Check that no dependency cycle was introduced.
- Check that error messages are clear and useful.
- Check that inputs are validated at system boundaries.
- Check that repeated values with domain meaning are named or configured.
- Check that the code follows the existing project style.
- Remove debugging output, commented-out code, temporary files, and unresolved
  `TODO` or `FIXME` notes.
- Confirm that all new dependencies and files are necessary.
- Confirm that the student can explain the implementation without reading a
  generated script.

## 8. Documentation and evidence

- The README must contain only commands and behaviour that have been verified.
- Design documents must match the implemented system. Proposed features must not
  be described as completed.
- Important assumptions, limitations, and deliberately excluded features must be
  stated honestly.
- External algorithms, formulas, datasets, images, or copied ideas must be cited
  according to the unit's required referencing style.
- Do not fabricate benchmarks, test results, citations, user feedback, or claims.
- Record enough evidence to connect each assessment requirement to its design,
  implementation, test, and demonstrated result.

## 9. Scalability and sustainability evidence

Because this is a scalability and sustainability project:

- Establish a simple working baseline before optimising.
- Measure performance with repeatable inputs and clearly named metrics.
- Record the environment and configuration used for each experiment.
- Separate measured results from assumptions or predictions.
- Explain trade-offs rather than claiming that one design is always best.
- Avoid premature optimisation and unnecessary infrastructure.
- Discuss computational cost, resource usage, limitations, and possible future
  improvements using evidence from the implemented system.

## 10. Academic quality standard

High-distinction quality should come from clarity and evidence, not code volume.
Each assessed feature should demonstrate:

- clear connection to a requirement
- a justified design decision
- focused and readable implementation
- meaningful tests
- reproducible evidence
- honest evaluation of limitations
- correct technical explanation by the student

The project should contain small, defensible decisions that fit its actual problem.
It should not imitate the size or architecture of a commercial system.

## 11. Working process

1. Agree on the current milestone before implementation.
2. Identify its requirements, exclusions, and completion checks.
3. Design the smallest suitable change.
4. Implement one coherent part at a time.
5. Test that part before continuing.
6. Review all changed files against this document.
7. Report exactly what was created, changed, tested, and left for later.

No later-phase feature may be added early without explicit approval. These rules
may be changed only after discussing and agreeing on the change.

## 12. Milestone completion checklist

A milestone is complete only when every answer is **yes**:

- Does it satisfy the approved requirement?
- Is every added file necessary?
- Is every dependency necessary and used?
- Is the code free from known dead code and circular dependencies?
- Are names, abstractions, imports, and comments clear?
- Are success, edge, and relevant failure behaviour tested?
- Do formatting, static checks, build, and tests pass?
- Does the documentation match the implementation?
- Are limitations and excluded future work stated honestly?
- Can the student explain and defend the result?
