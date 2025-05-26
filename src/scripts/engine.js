import { Chess } from "chess.js";
import showErrorMessage from "./errorMessage";
import getThreads from "../utils/getThreads";

let engineMessagesForEval = [];

const getEngineAnalysis = async (FENs, depth) => {
  let threads = getThreads();
  const worker = new Worker(
    typeof WebAssembly == "object"
      ? "/stockfish-17-lite-single.js"
      : "/stockfish.js"
  );
  worker.addEventListener("error", (err) => {
    console.error(` error: ${err.message || "Unknown error"}`);
  });
  worker.postMessage("uci");
  worker.postMessage(`setoption name Threads value ${threads}`);
  let response = [];
  let listOfBestmoves = [];
  for (let count = 0; count < FENs.length; count++) {
    if (count % 5 === 0 && count > 0) {
      console.log(`Analyzing position ${count}/${FENs.length}`);
    }
    let bestmove = false,
      evalValue;
    if (count == FENs.length - 1) {
      worker.postMessage("position fen " + FENs[count - 1]);
      worker.postMessage("go depth " + depth.toString());
      evalValue = await waitForKeyword(
        worker,
        "eval",
        depth,
        engineMessagesForEval,
        FENs[count]
      );
    } else {
      worker.postMessage("position fen " + FENs[count]);
      worker.postMessage("go depth " + depth.toString());
      engineMessagesForEval = [];
      const reply = await waitForKeyword(
        worker,
        "bestmove and eval",
        depth,
        engineMessagesForEval,
        FENs[count]
      );
      listOfBestmoves.push(reply[0]);
      evalValue = reply[1];
      engineMessagesForEval = [];
    }

    // convert the best move from UCI to SAN
    if (listOfBestmoves[count - 1]) {
      const tempchessboard = new Chess(FENs[count - 1]);
      const move = tempchessboard.move({
        from: listOfBestmoves[count - 1].slice(0, 2),
        to: listOfBestmoves[count - 1].slice(2, 4),
        promotion:
          listOfBestmoves[count - 1].length === 5
            ? listOfBestmoves[count - 1][4]
            : undefined,
      });
      bestmove = move.san;
    } else {
      bestmove = false;
    }

    // change eval if it is checkmate
    const checker = new Chess(FENs[count]);
    const checkmate = checker.isCheckmate();
    if (checkmate) {
      evalValue = {
        type: "mate",
        value: "0",
      };
    }


    // compile this shit frfr
    const compiled = {
      move_no: count,
      fen: FENs[count],
      best_move: bestmove,
      eval: evalValue,
    };
    console.log(compiled);
    response.push(compiled);
  }
  return response;
};

export default getEngineAnalysis;

const waitForKeyword = (worker, keyword, depth, engineMessagesForEval, fen) => {
  return new Promise((resolve) => {
    worker.addEventListener("message", (event) => {
      if (keyword === "eval") {
        engineMessagesForEval.push(event.data);
        if (event.data.startsWith("bestmove")) {
          const extractedEval = extractEval(
            event.data,
            depth,
            engineMessagesForEval,
            fen
          );
          if (extractedEval === "nuh uh") {
            showErrorMessage("depth not reached for some reason");
          } else if (extractedEval) {
            resolve(extractedEval);
          } else {
            showErrorMessage("depth reached but not found");
          }
        }
      } else {
        engineMessagesForEval.push(event.data);
        if (event.data.startsWith("bestmove")) {
          const foundBestmove = event.data.split(" ")[1];
          const extractedEval = extractEval(
            event.data,
            depth,
            engineMessagesForEval,
            fen
          );
          if (extractedEval === "nuh uh") {
            showErrorMessage("depth not reached for some reason");
          } else if (extractedEval) {
            resolve([foundBestmove, extractedEval]);
          } else {
            showErrorMessage("depth reached but not found");
          }
        }
      }
    });
  });
};

const extractEval = (engineMessage, depth, engineMessagesForEval, fen) => {
  engineMessage = engineMessagesForEval[engineMessagesForEval.length - 2];
  const depthRegex = new RegExp(`^.*info depth ${depth}\\b.*$`, "gm");
  const depthLine = engineMessage.match(depthRegex);
  if (!depthLine) {
    return "nuh uh";
  }
  const scoreRegex = /score (cp|mate) (-?\d+)/;
  const match = depthLine[0].match(scoreRegex);
  if (match) {
    let cpOrMateValue = Number(match[2]);
    if (fen.includes(" b ")) {
      cpOrMateValue = -1 * cpOrMateValue;
    }
    return {
      type: match[1],
      value: cpOrMateValue,
    };
  }

  return null; // depth found but no score
};
