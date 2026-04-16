# Tech Design: [Feature Title]

> **Epic**: [DRM-XXXX — Epic Title](../epics/DRM-XXXX/DRM-XXXX.md)
> **PRD**: [PRD](../epics/DRM-XXXX/PRD.md)
> Copy to `docs/sdlc/epics/DRM-XXXX/TECH-DESIGN.md`

---

## Metadata

| Field | Value |
|-------|-------|
| **Epic Key** | DRM-XXXX |
| **Author** | |
| **Reviewer** | |
| **Status** | `draft` / `review` / `approved` |
| **Created** | YYYY-MM-DD |
| **Approved** | YYYY-MM-DD |

---

## 1. Summary

_One paragraph: what is being built and the technical approach._

---

## 2. Architecture

### Component Diagram

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   View       │────►│  ViewModel   │────►│   Service    │
│  (SwiftUI)   │     │ @MainActor   │     │  (Protocol)  │
└──────────────┘     └──────────────┘     └──────────────┘
                                                │
                                                ▼
                                          ┌──────────────┐
                                          │  HTTPClient  │
                                          │  / Socket    │
                                          └──────────────┘
```

### Layer Mapping

| Layer | New/Modified | File |
|-------|-------------|------|
| **View** | New / Modified | `Views/.../.swift` |
| **ViewModel** | New / Modified | `Views/.../.swift` |
| **Service** | New / Modified | `Core/Services/.../.swift` |
| **API** | New / Modified | `Core/Network/APIs/.../.swift` |
| **Model** | New / Modified | `Core/Models/API/.../.swift` |
| **DI Registration** | Modified | `Core/DI/DIContainer.swift` |
| **Coordinator** | Modified | `Views/...Coordinator.swift` |
| **State** | Modified | `Core/State/AppState.swift` |

---

## 3. API Contract

### New/Modified Endpoints

```
[METHOD] /api/v2/endpoint
```

**Request**:
```json
{
  "field": "value"
}
```

**Response** (200):
```json
{
  "data": {}
}
```

**Error Responses**:
| Status | Body | Client Handling |
|--------|------|-----------------|
| 401 | Token expired | Auto-refresh via interceptor |
| 422 | Validation error | Show inline error |
| 500 | Server error | Show generic error toast |

### Swift Model

```swift
struct FeatureResponse: Codable {
    let id: String
    let field: String?  // Optional: backend may omit
}
```

---

## 4. State Management

| State | Location | Reason |
|-------|----------|--------|
| Feature data | Local ViewModel (`@Published`) | Scoped to this screen |
| Shared data | `AppState` / `SessionsState` | Needed across screens |
| Persistent | `UserDefaults` / `Keychain` | Survives app restart |

### State Flow

```
User Action → ViewModel.method() → Service.call() → API
                   │                                  │
                   ▼                                  ▼
              @Published var state = .loading    Response/Error
                   │                                  │
                   ▼                                  ▼
              View updates                   ViewModel updates state
```

---

## 5. Sequence Diagram

```
User          View          ViewModel       Service        API/Socket
 │              │               │              │              │
 │──tap──────►  │               │              │              │
 │              │──action()───► │              │              │
 │              │               │──request()──►│              │
 │              │               │              │──HTTP/WS───► │
 │              │               │              │◄──response── │
 │              │               │◄──result()── │              │
 │              │◄──@Published  │              │              │
 │◄──UI update  │               │              │              │
```

---

## 6. DI Registration

```swift
// New registrations in DIContainer.swift
container.register(FeatureServiceProtocol.self) { resolver in
    FeatureServiceImpl(
        httpClient: resolver.resolve(HTTPClient.self)!
    )
}
```

---

## 7. Navigation Changes

| Action | From | To | Method |
|--------|------|-----|--------|
| | Screen A | Screen B | Coordinator push / sheet / fullscreen |

---

## 8. Mobile-Specific Design

### Camera (if applicable)
- AVCaptureSession configuration changes?
- New output types?
- Session lifecycle impact?

### Offline Behavior
- What is cached locally?
- Queue mechanism for pending actions?
- Sync strategy on reconnect?

### Performance Budget

| Metric | Budget | Measurement |
|--------|--------|-------------|
| Screen load time | < 300ms | Instruments: Time Profiler |
| Memory increase | < 20MB | Instruments: Allocations |
| Battery impact | Negligible | Instruments: Energy Log |
| Binary size increase | < 500KB | Build report |

---

## 9. File Impact Summary

### New Files
| File | Purpose |
|------|---------|
| `Views/Feature/FeatureView.swift` | Main screen |
| `Views/Feature/FeatureViewModel.swift` | Screen logic |

### Modified Files
| File | Change |
|------|--------|
| `Core/DI/DIContainer.swift` | Add DI registration |

### Deleted Files
| File | Reason |
|------|--------|
| (none expected) | |

---

## 10. Risks & Technical Debt

| Risk | Impact | Mitigation |
|------|--------|------------|
| | | |

### Known Shortcuts
_Any technical debt being intentionally introduced and why._

---

## 11. Open Questions

| # | Question | Answer | Answered By |
|---|----------|--------|-------------|
| 1 | | | |
