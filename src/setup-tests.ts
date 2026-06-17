import "@testing-library/jest-dom/extend-expect";

globalThis.matchMedia =
    globalThis.matchMedia ||
    function () {
        return {
            matches: false,
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            addListener: function () {},
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            removeListener: function () {},
        };
    };
