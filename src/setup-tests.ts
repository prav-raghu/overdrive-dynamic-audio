import "@testing-library/jest-dom/vitest";

globalThis.matchMedia =
    globalThis.matchMedia ||
    function () {
        return {
            matches: false,
            addListener: function () {},
            removeListener: function () {},
        };
    };
