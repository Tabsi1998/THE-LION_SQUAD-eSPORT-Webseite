import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { SponsorLogo } from "./SponsorLogo";

// Logos einfarbig weiß (#1916, App-Teil von #1321): weiße Fassung, sonst durchsichtiges Logo eingefärbt, sonst das
// Original auf einer ruhigen Fläche.

jest.mock("./MediaImage", () => {
  const { View } = jest.requireActual("react-native");
  return { MediaImage: (props: { uri?: string; imageStyle?: unknown }) => <View testID="logo-image" {...{ uri: props.uri, imageStyle: props.imageStyle }} /> };
});

test("weiße Fassung: die App lädt sie statt des Originals", async () => {
  await render(<SponsorLogo logo={{ logo_url: "/farbe.png", logo_mono_url: "/weiss.png" }} testID="s" />);
  expect(screen.getByTestId("s-file")).toBeTruthy();
  expect(screen.getByTestId("logo-image").props.uri).toBe("/weiss.png");
});

test("durchsichtiges Logo: weiß eingefärbt", async () => {
  await render(<SponsorLogo logo={{ logo_url: "/farbe.png", logo_transparent: true }} testID="s" />);
  expect(screen.getByTestId("s-tint")).toBeTruthy();
  expect(StyleSheet.flatten(screen.getByTestId("logo-image").props.imageStyle)).toEqual({ tintColor: "#FFFFFF" });
});

test("Logo mit Kasten: Original auf ruhiger Fläche, nicht eingefärbt", async () => {
  await render(<SponsorLogo logo={{ logo_url: "/kasten.jpg", logo_transparent: false }} testID="s" />);
  const surface = StyleSheet.flatten(screen.getByTestId("s-surface").props.style);
  expect(surface.backgroundColor).toBe("rgba(255,255,255,0.06)");
  expect(screen.getByTestId("logo-image").props.uri).toBe("/kasten.jpg");
  expect(screen.getByTestId("logo-image").props.imageStyle).toBeUndefined();
});
