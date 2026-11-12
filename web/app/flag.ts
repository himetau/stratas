// src/ui/web.ts reads this flag once when it loads, so it must be set before anything from src/ui is imported.
(window as unknown as { stratasWeb: boolean }).stratasWeb = true;
