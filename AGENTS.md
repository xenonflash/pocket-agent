# pocket-agent - Agent Guidelines

This file provides coding guidelines for agents working on the pocket-agent TypeScript library.

## Essential Commands

### Build & Development
```bash
pnpm run dev          # Start development server with tsx watch
pnpm run build        # Build ESM, CJS, and UMD formats to dist/
```

### Testing
No test framework is currently configured. When adding tests, install and configure a test runner (vitest, jest, etc.) and add test scripts to package.json.

## TypeScript Configuration

- **Target**: ES2022
- **Module System**: ESNext (bundler resolution)
- **Strict Mode**: Enabled
- **No Implicit Any**: Enforced
- **Always Strict**: Enabled
- **File Extension**: .ts files only

## Code Style Guidelines

### Formatting
- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings and template literals
- **Semicolons**: Use semicolons consistently
- **Line Length**: No strict limit, but prefer readability
- **Trailing Commas**: Use in multi-line objects/arrays

### Naming Conventions
- **Types/Interfaces**: PascalCase (e.g., `Tool`, `Message`, `Model`)
- **Classes**: PascalCase (e.g., `Agent`)
- **Functions/Methods**: camelCase (e.g., `createAgent`, `run`, `buildSystemPrompt`)
- **Variables/Parameters**: camelCase (e.g., `messages`, `thoughts`, `config`)
- **Constants**: camelCase (e.g., `calculator`, `search`)
- **Private Members**: Prefix with `private` keyword (not underscores)
- **Enum/Union Types**: PascalCase for values (e.g., `"user" | "assistant"`)

### Imports
- Use named imports for exports: `import { Agent, Model, Tool } from "./index"`
- Relative paths for local files: `./index`, `./example`
- Group imports: library imports first, then local imports

### Type Annotations
- **Interfaces**: Define all public interfaces explicitly
- **Return Types**: Omit when inferred is clear (e.g., simple functions)
- **Parameters**: Always type function parameters
- **Unknown Types**: Use `unknown` for generic params, cast to specific type
- **Type Assertions**: Use `as` keyword when needed: `params as { task: string }`
- **Discriminated Unions**: Use for state types: `type Thought = { type: "action" } | { type: "thought" }`

### Class Structure
- **Properties**: Initialize at declaration or in constructor
- **Constructor**: Use parameter properties: `constructor(private config: AgentConfig) {}`
- **Methods**: Public methods first, private methods last
- **Interface Implementation**: Implement `Tool` interface for agent-as-tool pattern

### Error Handling
- Use try-catch for operations that may fail (JSON parsing, async operations)
- Consider adding error handling to `parseResponse()` and `execute()` methods
- Validate inputs where possible (e.g., tool existence checks)
- Return error messages as strings (currently used)

### Async Patterns
- Always use `async/await` for async operations
- Return `Promise<T>` from async functions
- Use `await` in loops when sequential execution is needed

### Code Organization
- **Export Structure**: Default export factory functions (`createAgent`)
- **File Order**: Interfaces first, then types, then classes, then factories
- **Related Code**: Keep related types and classes in the same file
- **Separation**: Example code in separate files (e.g., `example.ts`)

### Patterns & Architecture
- **Factory Functions**: Provide `createX()` functions for class instantiation
- **Configuration Objects**: Use config objects for complex initialization
- **Tool System**: Tools implement `Tool` interface with name, description, params, execute
- **Agent Composition**: Agents can be used as tools
- **String Parsing**: Use regex for parsing structured text responses
- **Default Values**: Provide sensible defaults (e.g., `maxIterations: 10`)

### Array & Object Operations
- Use array methods: `map()`, `filter()`, `find()`, `includes()`
- Destructure objects when extracting multiple properties: `const { a, b } = params`
- Template literals for multi-line strings and string interpolation
- JSON.stringify() for serialization, JSON.parse() for deserialization

### Module Exports
- Export interfaces, types, classes, and functions separately
- Provide default factory function for main exports
- Use `export const` for constants and named exports

## Building & Distribution

- **Output Formats**: ESM (`.es.js`), CJS (`.umd.cjs`), UMD (`.umd.cjs`)
- **Entry Point**: `src/index.ts`
- **Type Definitions**: Generated via vite-plugin-dts to `dist/index.d.ts`
- **Package Exports**: Configure in `package.json` exports field

## Best Practices

- Keep code minimal and focused (this is a "pocket" agent SDK)
- Prefer composition over inheritance
- Use type guards for discriminated unions
- Avoid any - use unknown for truly unknown types
- Document tool descriptions clearly for LLM understanding
- Consider adding JSDoc for public APIs
- Human-in-the-loop should be optional and configurable

## Adding New Features

1. Define interfaces first
2. Implement with strict typing
3. Add example usage
4. Update README if public API changes
5. Run build to verify type generation
