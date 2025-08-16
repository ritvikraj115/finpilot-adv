import { createGlobalStyle } from 'styled-components';

export default createGlobalStyle`
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: 'Segoe UI', Roboto, sans-serif;
    background: #f5f7fa;
    color: #333;
    font-size: 16px;
    line-height: 1.6;
  }

  a {
    text-decoration: none;
    color: inherit;
  }

  button, input, select, textarea {
    font-family: inherit;
    font-size: inherit;
    outline: none;
  }

  button {
    cursor: pointer;
  }

  img {
    max-width: 100%;
    display: block;
  }
`;

