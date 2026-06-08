# symantic addressing scheme (v0)

A **qualified name** is how an agent addresses a symbol in symantic — the input to every
symbol-taking op and the form of every symbol-shaped result. It is **name-based**, never a
byte offset or cursor: a result can be fed straight back into the next query.

Status: descriptive of the current implementation. Versioned `v0` (pre-1.0; may change).

## Grammar

```
qualifiedName := file ":" name [ "#" index ]
file          := a project-relative, forward-slashed path (e.g. "src/foo.ts")
name          := segment ( "::" segment )*
segment       := a declaration name; a quoted module name counts as one segment
index         := a non-negative integer
```

- **`file`** — relative to the tsconfig directory, forward slashes on every platform. The
  first `:` is the file/name boundary; the file part never contains a colon.
- **`name`** — one or more `::`-separated segments naming the path to the symbol through
  nesting (namespaces, classes, interfaces, modules). A bare single segment matches a
  declaration of that name at any depth.
- **`#index`** — zero-based selector among same-name / same-path collisions (overloads,
  declaration merging). Omitted when unambiguous.

### Why `::` and not `.`

`.` is a legal character inside quoted module names (`declare module "@scope.org/pkg.sub"`).
Using `.` as the separator would split such a name into spurious segments. `::` cannot
appear unquoted in a TypeScript identifier or module specifier, so every segment — including
a quoted, dotted module name — stays intact.

## Examples

```
src/shapes.ts:Circle                     a top-level class
src/shapes.ts:Circle::area               a method of that class
src/nested.ts:Model::Inner::Node         an interface nested two namespaces deep
src/a.ts:"@scope.org/pkg.sub"::Extra     a member of a quoted-name ambient module
src/shapes.ts:area                       bare segment — matches area at any depth
src/m.ts:overloaded#1                    the second of same-name declarations
```

## Resolution contract

- A name resolves to **one symbol**, or to **candidates** when ambiguous — symantic never
  silently guesses. Candidates carry their full `::` path so the caller can re-address
  precisely (or add `#index`).
- A malformed qualified name (missing `:`, empty file/name, empty `::` segment, bad
  `#index`) is **rejected** with an error that restates the grammar — diagnosable from the
  message alone, without consulting docs.

## Output addresses

Two address forms appear in results, both re-feedable:

- **Symbol address** — a `qualifiedName` as above, for the next symbol query.
- **Position** — `file:line:col` (1-based), for a human or a region read. Positions are
  outputs, never required as query input.

## Out of scope (v0)

- The persuasion piece ("agents need name-addressing, not byte-offsets") — a separate post.
- A conformance suite for third-party tools — future, once the contract stabilizes.
