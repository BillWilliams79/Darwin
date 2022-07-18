import varDump from '../classifier/classifier';

// make this a rest api call library that has no UI side effects.
// eventually replace with react-router or similar

const call_rest_api = async (url, method, body, idToken) => {

    // STEP 1 - construct a fetch init object, processing body
    // and incorporating any auth tokens
    const fetchInit = {
        method: method,
        headers: {
          'Content-Type': 'application/json',
        }
    };
    fetchInit['body'] = (body) ? JSON.stringify(body) : null;

    if (idToken) {
        fetchInit['headers']['Authorization'] = idToken;
    } else {
        console.log('error if idtoken required');
    }

    // STEP 2, perform fetch and catch the http status not between 200 and 499
    try {
        //varDump(url, "call_rest_api's url immediately before fetch call");
        varDump(fetchInit, "call_rest_api's fetchInit immediately before fetch call");
        var response = await fetch(url, fetchInit)
    } catch (error) {
        const errorReturn = {
            data: {},
            httpStatus: { httpMethod: fetchInit.method,
                               httpStatus: 503,
                               httpMessage: 'SERVICE UNAVAILABLE',},
        };
        return errorReturn;
    };

    // STEP 3 wait for JSON data and parse into javascript
    const jsonData = await response.json();
    var data = (jsonData.length > 0) ? JSON.parse(jsonData) : '';

    // STEP 4 construct responseData object and return it
    var httpStatus = {httpMethod: fetchInit.method,
                      httpStatus: response.status,
                      httpMessage: '',
    };

    // Generate httpMessage based on HTTP status
    if (response.status === 200) {
        httpStatus.httpMessage = 'OK';
    } else if (response.status === 201) {
        httpStatus.httpMessage = 'CREATED';
    } else if (response.status === 204) {
        httpStatus.httpMessage = 'NO CONTENT';
    } else {
        // there is some form of error, in which case the data returned
        // is actually the error message, unpleasant overload for now
        httpStatus.httpMessage = data;
        data = null;
        throw {data, httpStatus}
    }

    const returnValue = {
        data,
        httpStatus,
    };

    //varDump(returnValue, "call_rest_api's return value");

    return returnValue;
}

export default call_rest_api
